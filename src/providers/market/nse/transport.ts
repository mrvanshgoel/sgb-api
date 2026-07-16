// ─── NSE Outbound Transport Layer ────────────────────────────────────────
// Centralizes ALL outbound-networking configuration for the NSE provider so
// application code never has to know how the request leaves the box.
//
// Why this exists:
//   NSE sits behind Akamai Bot Manager, which blocks requests originating from
//   shared cloud egress IPs (the pooled outbound addresses used by Render,
//   Heroku, most PaaS free tiers, etc.). The exact same code that works from a
//   laptop returns HTTP 403 from those shared IPs. The fix is not a code change
//   but a networking one: route outbound requests through an IP the upstream
//   trusts (a dedicated/static egress, or an outbound proxy that owns one).
//
// This module reads that networking intent from environment variables, validates
// it at startup, and exposes it to the session layer. With nothing configured it
// behaves exactly as before (direct connection, same TLS fingerprint).

import { logger } from '../../../utils/logger.js';

export type TransportMode = 'Default' | 'Proxy' | 'Local Address';

export interface NseTransportConfig {
  /** Human-readable mode, logged at startup and surfaced on the health endpoint. */
  mode: TransportMode;
  /** Proxy URL passed straight to node-tls-client (undefined = no proxy). */
  proxy?: string;
  /** Whether the proxy rotates its exit IP each request. */
  isRotatingProxy: boolean;
  /** Bind outbound sockets to this local source IP (undefined = OS default). */
  localAddress?: string;
}

/**
 * Environment variables (all optional — absence = today's behavior):
 *
 *   NSE_PROXY_URL          Outbound proxy for NSE requests. Supports http(s) and
 *                          socks5 schemes with optional user:pass credentials,
 *                          e.g. http://user:pass@proxy.example.com:8080
 *   NSE_PROXY_ROTATING     'true' if the proxy rotates its exit IP per request.
 *   NSE_LOCAL_ADDRESS      Bind outbound sockets to this local source IPv4/IPv6
 *                          address — use on a host with multiple NICs where one
 *                          carries the dedicated/static egress IP.
 *
 * NSE_PROXY_URL and NSE_LOCAL_ADDRESS are mutually exclusive.
 */
const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);

function parseProxy(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'NSE_PROXY_URL is not a valid URL. Expected e.g. http://user:pass@host:port',
    );
  }
  if (!ALLOWED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `NSE_PROXY_URL uses unsupported protocol '${url.protocol}'. ` +
        `Use one of: http, https, socks5, socks5h.`,
    );
  }
  if (!url.hostname) {
    throw new Error('NSE_PROXY_URL is missing a hostname.');
  }
  return raw;
}

function isValidIp(value: string): boolean {
  // Compact IPv4 / IPv6 validity check — enough to catch typos at startup.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = value.match(ipv4);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  // Any colon-bearing token that URL accepts as a host we treat as IPv6.
  if (value.includes(':')) {
    try {
      // eslint-disable-next-line no-new
      new URL(`http://[${value}]`);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Masks credentials so a proxy URL can be logged without leaking secrets. */
export function redactProxy(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '';
    }
    return url.toString();
  } catch {
    return '[unparseable proxy url]';
  }
}

let _cached: NseTransportConfig | null = null;

/**
 * Reads and validates transport configuration from the environment.
 * Throws on invalid config so startup fails fast rather than silently
 * falling back to an IP that gets 403'd. Result is memoized.
 */
export function loadNseTransportConfig(): NseTransportConfig {
  if (_cached) return _cached;

  const rawProxy = (process.env.NSE_PROXY_URL || '').trim();
  const rawLocal = (process.env.NSE_LOCAL_ADDRESS || '').trim();
  const rotating = (process.env.NSE_PROXY_ROTATING || '').trim().toLowerCase() === 'true';

  if (rawProxy && rawLocal) {
    throw new Error(
      'NSE_PROXY_URL and NSE_LOCAL_ADDRESS are mutually exclusive — set only one.',
    );
  }

  if (rawProxy) {
    const proxy = parseProxy(rawProxy);
    _cached = { mode: 'Proxy', proxy, isRotatingProxy: rotating };
    return _cached;
  }

  if (rawLocal) {
    if (!isValidIp(rawLocal)) {
      throw new Error(`NSE_LOCAL_ADDRESS '${rawLocal}' is not a valid IPv4/IPv6 address.`);
    }
    _cached = { mode: 'Local Address', localAddress: rawLocal, isRotatingProxy: false };
    return _cached;
  }

  _cached = { mode: 'Default', isRotatingProxy: false };
  return _cached;
}

/** Test-only: clears the memoized config so env changes take effect. */
export function resetNseTransportConfig(): void {
  _cached = null;
}

/**
 * Validates config and logs the active transport mode (secrets redacted).
 * Call once at startup. Never logs raw credentials.
 */
export function initNseTransport(): NseTransportConfig {
  const cfg = loadNseTransportConfig();
  switch (cfg.mode) {
    case 'Proxy':
      logger.info(
        `Transport: Proxy (${redactProxy(cfg.proxy!)}${cfg.isRotatingProxy ? ', rotating' : ''})`,
      );
      break;
    case 'Local Address':
      logger.info(`Transport: Local Address (${cfg.localAddress})`);
      break;
    default:
      logger.info('Transport: Default');
  }
  return cfg;
}
