import { logger } from '../../../utils/logger.js';

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
    const { Session, ClientIdentifier, initTLS } = await import('node-tls-client');
    await initTLS();
    _session = new Session({
      clientIdentifier: ClientIdentifier.chrome_120,
      timeout: 30_000,
      insecureSkipVerify: false,
    });
    _initialized = true;
    logger.info('TLS session initialized (Chrome/120 fingerprint)');
  } catch (e: any) {
    logger.warn(`TLS client init failed, falling back to native fetch: ${e.message}`);
    _session = null;
    _initialized = true; // don't retry init on every request
  }
  return _session;
}

export class NseSessionManager {
  private lastRefreshTime: number = 0;
  private refreshPromise: Promise<void> | null = null;
  private consecutiveFailures: number = 0;

  // Stats for health reporting
  public stats = {
    refreshCount: 0,
    failureCount: 0,
    lastSuccess: null as Date | null,
    lastFailure: null as Date | null
  };

  private readonly REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes

  /**
   * Ensures the TLS session has a valid NSE homepage cookie.
   * With node-tls-client, cookies are stored internally in the session object,
   * so we don't need to manually extract and forward them.
   */
  public async ensureSession(): Promise<void> {
    const now = Date.now();

    // If we refreshed recently, skip
    if (this.lastRefreshTime && (now - this.lastRefreshTime < this.REFRESH_INTERVAL_MS)) {
      return;
    }

    // Dedup concurrent refreshes
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.fetchHomepage().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Forces a full session refresh (called on 403 from the API endpoint).
   */
  public async forceRefresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.lastRefreshTime = 0; // Reset so ensureSession forces a refresh
    return this.ensureSession();
  }

  private async fetchHomepage(retries = 3): Promise<void> {
    const session = await getOrCreateSession();
    try {
      this.stats.refreshCount++;
      logger.time('nse-session-refresh');

      if (!session) {
        // Fallback: native fetch (may still 403 on Render due to IP but keeps fallback path)
        const res = await fetch('https://www.nseindia.com', {
          headers: HOMEPAGE_HEADERS
        });
        if (res.status !== 200 && res.status !== 403) {
          throw new Error(`NSE homepage returned ${res.status}`);
        }
      } else {
        // TLS-impersonating session — handles cookies internally
        const res = await session.get('https://www.nseindia.com', {
          headers: HOMEPAGE_HEADERS,
          followRedirects: true
        });
        if (res.status !== 200 && res.status !== 403) {
          throw new Error(`NSE homepage returned ${res.status}`);
        }
      }

      this.lastRefreshTime = Date.now();
      this.consecutiveFailures = 0;
      this.stats.lastSuccess = new Date();

      logger.timeEnd('nse-session-refresh', 'NSE session refreshed successfully');
    } catch (error) {
      this.consecutiveFailures++;
      this.stats.failureCount++;
      this.stats.lastFailure = new Date();

      if (retries > 0) {
        const backoffMs = Math.pow(2, 4 - retries) * 1000;
        logger.warn(`Failed to refresh NSE session, retrying in ${backoffMs}ms...`);
        await new Promise(res => setTimeout(res, backoffMs));
        return this.fetchHomepage(retries - 1);
      }

      logger.error(`Failed to refresh NSE session: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Performs a GET request to the given URL using the TLS-impersonating session.
   * The session automatically includes its stored cookies.
   */
  public async get(url: string): Promise<{ status: number; text: () => Promise<string> }> {
    const session = await getOrCreateSession();

    if (!session) {
      // Fallback to native fetch (no TLS impersonation)
      const res = await fetch(url, { headers: API_HEADERS });
      return {
        status: res.status,
        text: () => res.text()
      };
    }

    const res = await session.get(url, {
      headers: API_HEADERS,
      followRedirects: true
    });

    return {
      status: res.status,
      text: () => res.text()
    };
  }

  public getCookieAgeSeconds(): number {
    if (!this.lastRefreshTime) return 0;
    return Math.floor((Date.now() - this.lastRefreshTime) / 1000);
  }
}

export const nseSessionManager = new NseSessionManager();
