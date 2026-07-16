import { logger } from '../../../utils/logger.js';
import { loadNseTransportConfig, type TransportMode } from './transport.js';
import { nseTracer, cookieNames } from './trace.js';

// ── Lazy-loaded TLS session (avoids startup cost when not needed) ──────────────
// node-tls-client wraps bogdanfinn/tls-client which impersonates Chrome's exact
// TLS ClientHello fingerprint (JA3/JA4), bypassing Akamai Bot Manager's TLS check.
// The session object also maintains its own internal cookie jar automatically.
//
// Akamai Bot Manager also demands a *warmed* browser session: valid bm_sv / nsit /
// nseappid cookies that only get set when a real browser navigates the site before
// hitting the JSON API. So before each API call we prime the cookie jar by GETting
// the homepage and the exact quote page for the symbol, then send the API request
// with a Referer that matches that quote page. This is the proven, free technique
// used by the actively-maintained hi-imcodeman/stock-nse-india project, which calls
// the identical /api/NextApi/apiClient/GetQuoteApi endpoint. The chrome_131 profile
// is the newest fingerprint this node-tls-client version ships.

let _session: any = null;
let _initialized = false;

const NSE_BASE = 'https://www.nseindia.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SEC_CH_UA = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';

// Cookies stay valid for a short window; re-warm past this to keep Akamai happy.
const COOKIE_MAX_AGE_MS = 60 * 1000;

// The reference project (hi-imcodeman/stock-nse-india) also re-warms after a fixed
// number of API calls on the same cookie jar (cookieUsedCount > 10), independent of
// the time window — Akamai appears to bind a warmed session to a small request
// budget. We replicate that so a hot jar doesn't get reused into a 403.
const COOKIE_MAX_USES = 10;

// Priming is best-effort. On a blocked egress IP the HTML page GETs can be
// tar-pitted and hang for the full session timeout, which would stall every
// quote by ~30s. Bound each priming GET so it can never block longer than this;
// if it times out we proceed to the API call anyway (the 403-retry path handles
// the rest). The API call itself keeps the full session timeout.
const WARM_TIMEOUT_MS = 6 * 1000;

/** Resolves to null if `p` doesn't settle within `ms` — never rejects. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

const HOMEPAGE_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-Ch-Ua': SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"'
};

const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Authority': 'www.nseindia.com',
  'Origin': NSE_BASE,
  'Referer': `${NSE_BASE}/`,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Ch-Ua': SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

/** Pulls the trading symbol out of a GetQuoteApi URL, for quote-page warming. */
function extractSymbol(url: string): string | null {
  const m = url.match(/[?&]symbol=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getOrCreateSession(): Promise<any> {
  if (_session && _initialized) return _session;

  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { fileURLToPath } = await import('node:url');

    // Copy pre-packaged binary to temp dir on Linux x64 to bypass GitHub 403 WAF block on Render
    if (process.platform === 'linux' && process.arch === 'x64') {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      // relative path to dist/bin/tls-client-x64.so from dist/providers/market/nse/session.js
      const sourcePath = path.join(__dirname, '..', '..', '..', 'bin', 'tls-client-x64.so');
      const destPath = path.join(os.tmpdir(), 'tls-client-x64.so');
      
      if (fs.existsSync(sourcePath)) {
        if (!fs.existsSync(destPath)) {
          logger.info(`Copying pre-packaged tls-client-x64.so to temp dir: ${destPath}`);
          fs.copyFileSync(sourcePath, destPath);
        } else {
          logger.info('pre-packaged tls-client-x64.so already exists in temp dir');
        }
      } else {
        logger.warn(`Pre-packaged binary not found at ${sourcePath}`);
      }
    }

    const { Session, ClientIdentifier, initTLS } = await import('node-tls-client');
    await initTLS();

    // Apply centralized outbound transport (proxy / local address / direct).
    const transport = loadNseTransportConfig();
    const sessionOpts: Record<string, unknown> = {
      clientIdentifier: ClientIdentifier.chrome_131,
      timeout: 30_000,
      insecureSkipVerify: false,
      disableIPV6: true,
    };
    if (transport.proxy) {
      sessionOpts.proxy = transport.proxy;
      sessionOpts.isRotatingProxy = transport.isRotatingProxy;
    }
    if (transport.localAddress) {
      sessionOpts.localAddress = transport.localAddress;
    }

    _session = new Session(sessionOpts);
    _initialized = true;
    logger.info(
      `TLS session initialized (Chrome/131 fingerprint, IPv6 disabled, transport: ${transport.mode})`,
    );
  } catch (e: any) {
    logger.warn(`TLS client init failed, falling back to native fetch: ${e.message}`);
    _session = null;
    _initialized = true; // don't retry init on every request
  }
  return _session;
}

export class NseSessionManager {
  private lastSessionReset: number = 0;
  // Timestamp until which the warmed Akamai cookie jar is considered valid.
  private cookieValidUntil: number = 0;
  // How many API calls have reused the current warmed jar (see COOKIE_MAX_USES).
  private cookieUsedCount: number = 0;

  // Stats for health reporting
  public stats = {
    refreshCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    lastSuccess: null as Date | null,
    lastFailure: null as Date | null,
    lastLatencyMs: null as number | null,
    lastHttpStatus: null as number | null,
  };

  /** The active outbound transport mode, surfaced on the health endpoint. */
  public get transportMode(): TransportMode {
    return loadNseTransportConfig().mode;
  }

  private recordSuccess(status: number, latencyMs: number): void {
    this.stats.lastSuccess = new Date();
    this.stats.consecutiveFailures = 0;
    this.stats.lastHttpStatus = status;
    this.stats.lastLatencyMs = latencyMs;
  }

  private recordFailure(status: number, latencyMs: number): void {
    this.stats.failureCount++;
    this.stats.consecutiveFailures++;
    this.stats.lastFailure = new Date();
    this.stats.lastHttpStatus = status;
    this.stats.lastLatencyMs = latencyMs;
    if (status === 403) {
      logger.warn('HTTP 403 from NSE');
    }
    if (this.stats.consecutiveFailures >= 3) {
      logger.warn('Provider unhealthy');
    }
  }

  /**
   * Primes the Akamai cookie jar so the API call is accepted. Navigates the
   * homepage and the exact quote page for the symbol (like a real browser)
   * so Set-Cookie values (bm_sv / nsit / nseappid) land in the session jar.
   * Best-effort: NSE often 403/503s the HTML pages under load, but the cookies
   * are still set on the response, so we don't treat that as fatal.
   */
  private async warmSession(session: any, symbol: string | null, force: boolean): Promise<void> {
    if (!session) return;
    const jarExhausted = this.cookieUsedCount > COOKIE_MAX_USES;
    if (!force && !jarExhausted && Date.now() < this.cookieValidUntil) return;

    try {
      await withTimeout(
        this.tracedGet(session, NSE_BASE + '/', HOMEPAGE_HEADERS, 'homepage'),
        WARM_TIMEOUT_MS,
      );
      if (symbol) {
        const quotePage = `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`;
        await withTimeout(
          this.tracedGet(
            session,
            quotePage,
            { ...HOMEPAGE_HEADERS, Referer: `${NSE_BASE}/` },
            'quote-page',
          ),
          WARM_TIMEOUT_MS,
        );
      }
      this.cookieValidUntil = Date.now() + COOKIE_MAX_AGE_MS;
      this.cookieUsedCount = 0;
      this.lastSessionReset = Date.now();
    } catch {
      // Priming is best-effort — the API call below still tries, and a 403
      // there triggers a forced refresh via the provider's retry path.
    }
  }

  /**
   * Wraps a session.get with trace capture: records URL, order, status, redirect,
   * final headers (redacted), and the cookie-jar delta around the request. When the
   * tracer is inactive (default) this is a thin passthrough with no jar reads.
   */
  private async tracedGet(
    session: any,
    url: string,
    headers: Record<string, string>,
    phase: string,
  ): Promise<any> {
    if (!nseTracer.active) {
      return session.get(url, { headers, followRedirects: true });
    }
    const before = cookieNames(await session.cookies().catch(() => []));
    const start = Date.now();
    let res: any = null;
    let error: string | undefined;
    try {
      res = await session.get(url, { headers, followRedirects: true });
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    const after = cookieNames(await session.cookies().catch(() => []));
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    nseTracer.record({
      phase,
      method: 'GET',
      url,
      status: res?.status ?? null,
      finalUrl: res?.url ?? null,
      redirected: !!res?.url && res.url !== url,
      requestHeaders: headers,
      cookiesBefore: before,
      cookiesAfter: after,
      cookiesAdded: after.filter((n) => !beforeSet.has(n)),
      cookiesRemoved: before.filter((n) => !afterSet.has(n)),
      error,
      latencyMs: Date.now() - start,
    });
    if (error) throw new Error(error);
    return res;
  }

  /**
   * Forces a full session reset (called on 403 from the API endpoint).
   * This recreates the underlying node-tls-client session to get a fresh connection.
   */
  public async forceRefresh(): Promise<void> {
    logger.info('Refreshing NSE session');
    this.stats.refreshCount++;
    _session = null;
    _initialized = false;
    this.cookieValidUntil = 0;
    this.cookieUsedCount = 0;
    await getOrCreateSession();
    this.lastSessionReset = Date.now();
    logger.info('Session refreshed');
  }

  /**
   * Performs a GET request to the given URL using the TLS-impersonating session.
   * All outbound NSE requests flow through here — the single transport chokepoint.
   * Before an API call it warms the Akamai cookie jar and sets a Referer that
   * matches the symbol's quote page.
   */
  public async get(url: string): Promise<{ status: number; text: () => Promise<string> }> {
    const session = await getOrCreateSession();
    const symbol = extractSymbol(url);

    if (!session) {
      // Fallback to native fetch (no TLS impersonation, no cookie priming)
      const startTime = Date.now();
      const res = await fetch(url, { headers: API_HEADERS });
      const latency = Date.now() - startTime;
      if (res.status === 200) {
        this.recordSuccess(res.status, latency);
      } else {
        this.recordFailure(res.status, latency);
      }
      return {
        status: res.status,
        text: () => res.text(),
      };
    }

    // Warm the Akamai cookie jar (homepage + quote page) before the API call.
    await this.warmSession(session, symbol, false);

    const headers = { ...API_HEADERS };
    if (symbol) {
      headers.Referer = `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`;
    }

    const startTime = Date.now();
    const res = await this.tracedGet(session, url, headers, 'api');
    const latency = Date.now() - startTime;
    this.cookieUsedCount++;

    if (res.status === 200) {
      this.recordSuccess(res.status, latency);
    } else {
      this.recordFailure(res.status, latency);
      // Invalidate the warmed jar so the next attempt re-primes fresh cookies.
      this.cookieValidUntil = 0;
    }

    return {
      status: res.status,
      text: () => res.text(),
    };
  }

  public getCookieAgeSeconds(): number {
    if (!this.lastSessionReset) return 0;
    return Math.floor((Date.now() - this.lastSessionReset) / 1000);
  }
}

export const nseSessionManager = new NseSessionManager();
