# SGB API

**Open-source, self-hostable REST API for India's Sovereign Gold Bonds (SGBs).**

Complete, hand-verified data on every RBI SGB series ever issued, plus optional live market and gold price data — every value traceable to an official source, or explicitly `null` with a reason. Never fabricated, never estimated, never predicted.

- **Node.js + TypeScript + Fastify**, MIT licensed
- Provider-based architecture — swap any data source without touching core code
- Deterministic calculations only (coupon schedules, maturity countdowns, interest accounting)
- OpenAPI docs served at `/docs`

## Core principles

1. **Never fabricate.** Every static data record carries a `provenance` block pointing at the exact RBI notification it was verified against.
2. **Never guess.** If a value can't be obtained from a compliant source, it is `null` with a `reason` — by design, not by accident. See [DATA_SOURCES.md](DATA_SOURCES.md).
3. **Never predict.** No price forecasts, no NAV estimates, no interpolation.
4. **Missing data is not an error.** `/market/*` and `/gold` always return `200` with a null-shaped payload when no source is configured — exceptions are reserved for malformed requests.

## Quickstart

```bash
# Docker (recommended)
docker compose up

# or locally
npm ci
npm run dev
```

The API listens on `http://localhost:3000` — interactive docs at `http://localhost:3000/docs`.

Out of the box, the API serves the full static SGB database with **no external dependencies and no API keys**. Live market/gold prices are opt-in (see below).

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /series` | All SGB series |
| `GET /series/{symbol}` | Single series by trading symbol (e.g. `SGBJUL28IV`) |
| `GET /isin/{isin}` | Single series by ISIN (e.g. `IN0020200245`) |
| `GET /security/{securityCode}` | Single series by BSE scrip code |
| `GET /lookup/{identifier}` | **Universal lookup** — auto-detects ISIN / security code / symbol / series name / alias; returns `matchedBy`, falls back to fuzzy `suggestions` |
| `GET /search?q=...` | Fuzzy/structured search (`exchange`, `issueYear`, `maturityYear`, `activeOnly` filters) |
| `GET /market/{symbol}` | Live market data (null-shaped `200` when no provider configured) |
| `GET /gold` | Live gold price (independent of SGB data) |
| `GET /health` | Health + configured provider names |
| `GET /docs` | OpenAPI / Swagger UI |

Every series response includes:

- the stored, precomputed `couponSchedule` (generated once at data build time — request-time logic is pure lookup) with request-time `paid`/`upcoming` statuses
- a `derived` block: `nextCouponDate`, `remainingCoupons`, `interestReceivedPerUnit`, `daysToMaturity`, `prematureRedemptionEligible`, … — all deterministic, never price-derived
- the full `provenance` block

## Live data providers (opt-in)

### Market data — Groww Trade API (official)

Uses [Groww's official, documented Trade API](https://groww.in/trade-api/docs) with **your own** paid Trading API subscription. No scraping.

```env
MARKET_DATA_PROVIDER=groww
GROWW_ACCESS_TOKEN=your-daily-token   # or GROWW_API_KEY
```

Notes:
- Groww's quote API does not provide `valueTraded` or a literal previous-close field; `valueTraded` is `null` by design and `previousClose` is derived exactly from `last_price − day_change` when both are present.
- Groww access tokens expire daily at 6:00 AM IST.

### Why is there no NSE/BSE provider?

NSE has **no officially documented public quote API**. The `nseindia.com/api/*` JSON endpoints are undocumented website internals behind bot protection, and NSE routes legitimate programmatic data access through paid subscription agreements (NSE Data & Analytics). Building a scraper on those endpoints would be both fragile and outside sanctioned use — so this project ships **no** NSE scraper. The same reasoning applies to BSE. If you hold a licensed data feed, implement `MarketPriceProvider` against it (see below).

### Gold & Silver price — CoinGecko + Yahoo Finance (Failover)

The API fetches live gold and silver prices entirely via free providers, prioritizing **CoinGecko**, and automatically falling back to **Yahoo Finance** if CoinGecko is rate-limited or unavailable.

No API keys are required. Prices are cached for 60 seconds (successes only) to ensure fast responses while respecting provider rate limits.

## Architecture

```
src/
  app.ts                  entry point
  build-app.ts            Fastify app factory (dependency injection)
  container.ts            default provider composition from env config
  cache/                  CacheProvider interface + InMemoryCache
  providers/
    interfaces.ts         SeriesProvider, LookupProvider, MarketPriceProvider,
                          GoldProvider, SearchProvider
    series.ts             StaticSeriesProvider (indexed JSON dataset)
    lookup.ts             identifier auto-detection
    search.ts             Fuse.js fuzzy + structured search
    cached.ts             caching decorators for price providers
    null-providers.ts     honest null-shaped defaults
    market/groww.ts       official Groww Trade API
    gold/metals-dev.ts    metals.dev
  services/
    coupon-generator.ts   deterministic schedule generation (build time)
    derived.ts            request-time lookups over stored schedules
  routes/                 Fastify routes + JSON schemas (→ OpenAPI)
  data/
    raw-series.ts         hand-verified source data with provenance
    sgb-series.json       generated dataset (npm run build:data)
```

### Writing your own provider

Implement one interface and inject it — core code doesn't change:

```ts
import { buildApp } from './build-app.js';
import type { MarketPriceProvider } from './providers/interfaces.js';

class MyBrokerProvider implements MarketPriceProvider {
  readonly name = 'my-broker';
  async getPrice(record) {
    // MUST NOT throw — return a null-shaped result on any failure
  }
}

const app = await buildApp({ ...defaultDeps, marketPriceProvider: new MyBrokerProvider() });
```

The one hard contract: **price providers never throw**. Return `nullMarketResult(reason)` / `nullGoldResult(reason)` from `providers/null-providers.js` on any failure.

### Caching

| Data | TTL |
|---|---|
| Static series + coupon schedules | Never expires (precomputed at build time) |
| Market data | 5 min (`MARKET_DATA_TTL`) |
| Gold price | 15 min (`GOLD_PRICE_TTL`) |

Failures are never cached — a transient outage won't pin "unavailable" for the full TTL. Swap `InMemoryCache` for Redis (or anything) by implementing `CacheProvider`.

## Development

```bash
npm run dev            # dev server with reload
npm test               # unit + provider + integration tests
npm run lint           # eslint
npm run build:data     # regenerate sgb-series.json from raw-series.ts
npm run validate:data  # CI data gate: schema + invariants + provenance
npm run build          # compile TypeScript
```

## Deployment

The API is stateless and self-contained — the full SGB dataset is baked into the image at build time, so a default deployment needs **no database, no external services, and no API keys**.

### Docker (recommended)

```bash
# Build and run the production image
docker compose up -d --build

# or without compose
docker build -t sgb-api .
docker run -d -p 3000:3000 --env-file .env --name sgb-api sgb-api
```

The multi-stage `Dockerfile` compiles TypeScript, ships only production dependencies, runs as a non-root `node` user, and defines a `HEALTHCHECK` against `/health`. Point your load balancer / orchestrator liveness+readiness probes at `GET /health` (returns `200` with `status: "ok"`).

### Configuration

All configuration is via environment variables — copy the template and edit:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Set to `production` when deployed |
| `MARKET_DATA_PROVIDER` | `null` | `null` or `groww` |
| `GROWW_ACCESS_TOKEN` / `GROWW_API_KEY` | — | Only if `MARKET_DATA_PROVIDER=groww` |
| `MARKET_DATA_TTL` | `300` | Market cache TTL (seconds) |

Secrets are read from the environment only — **never commit a real `.env`** (it is git-ignored; only `.env.example` is tracked).

### Bare metal / VM

```bash
npm ci
npm run build            # compile TS + copy dataset into dist/
NODE_ENV=production node dist/app.js
```

Put it behind a reverse proxy (nginx/Caddy) for TLS, and run under a process manager (systemd, pm2) so it restarts on failure. Horizontal scaling needs no coordination — instances are independent; the only shared-cache consideration is the optional Redis `CacheProvider` (see [Caching](#caching)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — in particular: **no data record is accepted without a `sourceDocument` URL and `sourceHash`**, and CI validates every record against the schema on every PR.

Community standards: please also read the [Code of Conduct](CODE_OF_CONDUCT.md) and, for anything security-related, the [Security Policy](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
