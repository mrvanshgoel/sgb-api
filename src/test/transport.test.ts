// ─── NSE Transport Layer Tests ───────────────────────────────────────────
// Config parsing, validation, mutual exclusion, and secret redaction.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadNseTransportConfig,
  resetNseTransportConfig,
  redactProxy,
} from '../providers/market/nse/transport.js';

const ENV_KEYS = ['NSE_PROXY_URL', 'NSE_PROXY_ROTATING', 'NSE_LOCAL_ADDRESS'];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe('NSE transport config', () => {
  beforeEach(() => {
    clearEnv();
    resetNseTransportConfig();
  });

  afterEach(() => {
    clearEnv();
    resetNseTransportConfig();
  });

  it('defaults to Default mode with nothing configured', () => {
    const cfg = loadNseTransportConfig();
    expect(cfg.mode).toBe('Default');
    expect(cfg.proxy).toBeUndefined();
    expect(cfg.localAddress).toBeUndefined();
    expect(cfg.isRotatingProxy).toBe(false);
  });

  it('parses a valid proxy URL', () => {
    process.env.NSE_PROXY_URL = 'http://user:pass@proxy.example.com:8080';
    const cfg = loadNseTransportConfig();
    expect(cfg.mode).toBe('Proxy');
    expect(cfg.proxy).toBe('http://user:pass@proxy.example.com:8080');
    expect(cfg.isRotatingProxy).toBe(false);
  });

  it('honors the rotating-proxy flag', () => {
    process.env.NSE_PROXY_URL = 'socks5://proxy.example.com:1080';
    process.env.NSE_PROXY_ROTATING = 'true';
    const cfg = loadNseTransportConfig();
    expect(cfg.mode).toBe('Proxy');
    expect(cfg.isRotatingProxy).toBe(true);
  });

  it('rejects an unsupported proxy protocol', () => {
    process.env.NSE_PROXY_URL = 'ftp://proxy.example.com:21';
    expect(() => loadNseTransportConfig()).toThrow(/unsupported protocol/);
  });

  it('rejects a malformed proxy URL', () => {
    process.env.NSE_PROXY_URL = 'not-a-url';
    expect(() => loadNseTransportConfig()).toThrow(/valid URL/);
  });

  it('parses a valid local address', () => {
    process.env.NSE_LOCAL_ADDRESS = '203.0.113.10';
    const cfg = loadNseTransportConfig();
    expect(cfg.mode).toBe('Local Address');
    expect(cfg.localAddress).toBe('203.0.113.10');
  });

  it('rejects an invalid local address', () => {
    process.env.NSE_LOCAL_ADDRESS = '999.1.1.1';
    expect(() => loadNseTransportConfig()).toThrow(/not a valid/);
  });

  it('rejects setting both proxy and local address', () => {
    process.env.NSE_PROXY_URL = 'http://proxy.example.com:8080';
    process.env.NSE_LOCAL_ADDRESS = '203.0.113.10';
    expect(() => loadNseTransportConfig()).toThrow(/mutually exclusive/);
  });

  it('memoizes config until reset', () => {
    const first = loadNseTransportConfig();
    process.env.NSE_PROXY_URL = 'http://proxy.example.com:8080';
    const second = loadNseTransportConfig();
    expect(second).toBe(first); // cached — env change ignored until reset
    resetNseTransportConfig();
    expect(loadNseTransportConfig().mode).toBe('Proxy');
  });
});

describe('redactProxy', () => {
  it('masks credentials', () => {
    const out = redactProxy('http://user:secret@proxy.example.com:8080/');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('user');
    expect(out).toContain('proxy.example.com');
  });

  it('leaves credential-free URLs recognizable', () => {
    const out = redactProxy('socks5://proxy.example.com:1080/');
    expect(out).toContain('proxy.example.com');
  });

  it('never throws on an unparseable value', () => {
    expect(redactProxy('::::')).toBe('[unparseable proxy url]');
  });
});
