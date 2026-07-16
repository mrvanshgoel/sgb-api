import { logger } from '../../../utils/logger.js';

export class NseSessionManager {
  private activeCookie: string | null = null;
  private lastRefreshTime: number = 0;
  private refreshPromise: Promise<string> | null = null;
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
   * Returns the current valid cookie, refreshing if necessary.
   */
  public async getCookie(): Promise<string> {
    const now = Date.now();
    
    // If we have a cookie and it's fresh enough, return it.
    if (this.activeCookie && (now - this.lastRefreshTime < this.REFRESH_INTERVAL_MS)) {
      return this.activeCookie;
    }

    // Otherwise, force a refresh. Use existing promise if already fetching.
    return this.forceRefresh();
  }

  /**
   * Forces a refresh of the cookie. Thread-safe (only one fetch at a time).
   */
  public async forceRefresh(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.fetchNewCookie().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async fetchNewCookie(retries = 3): Promise<string> {
    try {
      this.stats.refreshCount++;
      
      const headers = {
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
      
      const res = await fetch('https://www.nseindia.com', { headers });
      
      if (res.status !== 200 && res.status !== 403) {
        throw new Error(`NSE homepage returned ${res.status}`);
      }
      
      const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (setCookieHeader.length === 0) {
        throw new Error("No set-cookie header received from NSE");
      }
      
      const cookieStr = setCookieHeader.map(c => c.split(';')[0].trim()).join('; ');

      this.activeCookie = cookieStr;
      this.lastRefreshTime = Date.now();
      this.consecutiveFailures = 0;
      this.stats.lastSuccess = new Date();
      
      logger.info('NSE session refreshed successfully');
      
      return cookieStr;
    } catch (error) {
      this.consecutiveFailures++;
      this.stats.failureCount++;
      this.stats.lastFailure = new Date();
      
      if (retries > 0) {
        // Exponential backoff
        const backoffMs = Math.pow(2, 4 - retries) * 1000;
        logger.warn(`Failed to refresh NSE session, retrying in ${backoffMs}ms...`);
        await new Promise(res => setTimeout(res, backoffMs));
        return this.fetchNewCookie(retries - 1);
      }
      
      logger.error(`Failed to refresh NSE session: ${(error as Error).message}`);
      throw error;
    }
  }

  public getCookieAgeSeconds(): number {
    if (!this.lastRefreshTime) return 0;
    return Math.floor((Date.now() - this.lastRefreshTime) / 1000);
  }
}

export const nseSessionManager = new NseSessionManager();
