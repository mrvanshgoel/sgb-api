import { logger } from '../../../utils/logger.js';
import { loadNseTransportConfig, type TransportMode } from './transport.js';

// ── Lazy-loaded TLS session (avoids startup cost when not needed) ──────────────
// node-tls-client wraps bogdanfinn/tls-client which impersonates Chrome's exact
// TLS ClientHello fingerprint (JA3/JA4), bypassing Akamai Bot Manager's TLS check.
// The session object also maintains its own internal cookie jar automatically.

let _session: any = null;
let _initialized = false;

const HOMEPAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"'
};

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Referer': 'https://www.nseindia.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

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
      clientIdentifier: ClientIdentifier.chrome_120,
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
      `TLS session initialized (Chrome/120 fingerprint, IPv6 disabled, transport: ${transport.mode})`,
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
   * Forces a full session reset (called on 403 from the API endpoint).
   * This recreates the underlying node-tls-client session to get a fresh connection.
   */
  public async forceRefresh(): Promise<void> {
    logger.info('Refreshing NSE session');
    this.stats.refreshCount++;
    _session = null;
    _initialized = false;
    await getOrCreateSession();
    this.lastSessionReset = Date.now();
    logger.info('Session refreshed');
  }

  /**
   * Performs a GET request to the given URL using the TLS-impersonating session.
   * All outbound NSE requests flow through here — the single transport chokepoint.
   */
  public async get(url: string): Promise<{ status: number; text: () => Promise<string> }> {
    const session = await getOrCreateSession();
    const startTime = Date.now();

    if (!session) {
      // Fallback to native fetch (no TLS impersonation)
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

    const res = await session.get(url, {
      headers: API_HEADERS,
      followRedirects: true,
    });
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

  public getCookieAgeSeconds(): number {
    if (!this.lastSessionReset) return 0;
    return Math.floor((Date.now() - this.lastSessionReset) / 1000);
  }
}

export const nseSessionManager = new NseSessionManager();
