import { isDebug } from '../../../utils/logger.js';

// ── NSE request tracer (diagnostics only) ──────────────────────────────────────
// Records every outbound NSE request so our exact sequence — URLs, order, status,
// redirects, cookie-jar deltas, final headers — can be compared request-by-request
// against the reference project (hi-imcodeman/stock-nse-india). Off unless DEBUG=true
// or explicitly armed for the next trace via /debug/nse-trace. Never stores cookie
// *values* or credential header values, only names / redacted markers.

export interface TraceEntry {
  seq: number;
  phase: string; // 'homepage' | 'quote-page' | 'api'
  method: string;
  url: string;
  status: number | null;
  finalUrl: string | null;
  redirected: boolean;
  requestHeaders: Record<string, string>;
  cookiesBefore: string[];
  cookiesAfter: string[];
  cookiesAdded: string[];
  cookiesRemoved: string[];
  error?: string;
  latencyMs: number;
}

const SENSITIVE_HEADER = /^(cookie|authorization|proxy-authorization)$/i;

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER.test(k) ? '[redacted]' : v;
  }
  return out;
}

class NseTracer {
  private entries: TraceEntry[] = [];
  private seq = 0;
  private armed = false; // one-shot capture requested via the debug endpoint
  private readonly MAX = 50;

  /** True when the next request sequence should be captured. */
  public get active(): boolean {
    return isDebug || this.armed;
  }

  /** Arm a fresh one-shot capture and clear the previous trace. */
  public arm(): void {
    this.armed = true;
    this.entries = [];
    this.seq = 0;
  }

  public disarm(): void {
    this.armed = false;
  }

  public record(e: Omit<TraceEntry, 'seq' | 'requestHeaders'> & { requestHeaders: Record<string, string> }): void {
    if (!this.active) return;
    this.entries.push({ ...e, seq: this.seq++, requestHeaders: redactHeaders(e.requestHeaders) });
    if (this.entries.length > this.MAX) this.entries.shift();
  }

  public snapshot(): TraceEntry[] {
    return [...this.entries];
  }
}

export const nseTracer = new NseTracer();

/** Extracts unique cookie names (never values) from a node-tls-client serialized jar. */
export function cookieNames(serialized: Array<{ key?: string }> | undefined): string[] {
  if (!Array.isArray(serialized)) return [];
  const names = serialized.map((c) => c.key ?? '').filter(Boolean);
  return [...new Set(names)].sort();
}
