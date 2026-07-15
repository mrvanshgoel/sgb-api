# Data Sources

Every data point served by this API is either **backed by an official source** or **structurally `null` by design**. This document is the audit map.

## Static series data (`/series`, `/lookup`, `/search`, `/isin`, `/security`)

| Field | Source | Notes |
|---|---|---|
| `rbiSeries`, `issueDate`, `issuePrice` | RBI press releases (rbi.org.in) | Cited per record in `provenance.sourceDocument` |
| `subscriptionStart`, `subscriptionEnd` | RBI press releases / issue calendars | `null` where the notification wasn't independently verified |
| `onlineDiscountPrice` | RBI press releases | ₹50/gram online discount, introduced 2016-17 Series II; earlier tranches → `null` |
| `interestRate`, `interestFrequency` | RBI SGB scheme notifications | 2.75% for 2015-16 tranches, 2.5% thereafter |
| `isin` | NSE/BSE official listings (incl. archive.org captures of official pages) and Groww's official instrument master | GoI securities — `IN0020...` prefix. `null` where unverified |
| `tradingSymbol` | NSE official listings / official instrument masters | |
| `securityCode` | BSE official listings | `null` where unverified |
| `maturityDate` | RBI notifications (8 years from issue) | Computed as issue + 8y only when the notification states the standard tenor |
| `prematureRedemptionEligibilityDate` | RBI scheme terms (5th year onwards, on coupon dates) | Computed as issue + 5y |
| `couponSchedule` | **Deterministic computation** | `faceValue × rate ÷ 2` per semi-annual period from issue to maturity — generated once at build time, not fetched |
| `provenance` | — | Per-record audit block: `sourceDocument`, `sourceHash`, `lastVerified`, `verifiedBy` |

### Verification workflow

Records are compiled from RBI press releases; each record's `sourceHash` is the SHA-256 of its source document, so drift/tampering in the upstream document is detectable. CI validates schema + invariants on every PR (`npm run validate:data`).

## Derived fields (`derived` block)

All **deterministic lookups** over the stored coupon schedule and calendar math — no external data, no market prices:

`currentCouponNumber`, `nextCouponDate`, `nextCouponAmount`, `remainingCoupons`, `totalCoupons`, `interestReceivedPerUnit`, `interestRemainingPerUnit`, `totalInterestPerUnit`, `isMatured`, `daysToMaturity`, `yearsRemaining`, `prematureRedemptionEligible`.

This API **never** computes premium/discount/NAV, and never predicts prices.

## Live market data (`/market/{symbol}`)

| Provider | Status | Source basis |
|---|---|---|
| `null` (default) | ✅ shipped | Returns `marketPrice: null` + `reason` — honest absence |
| `groww` | ✅ shipped | [Groww Trade API](https://groww.in/trade-api/docs) — official, documented, user's own paid subscription. Real-time NSE CASH-segment quotes; SGBs are present in Groww's official instrument master (series `GB`) |
| NSE direct | ❌ **not shipped, by design** | No officially documented public API. `nseindia.com/api/*` endpoints are undocumented, bot-protected website internals; NSE's sanctioned channel is paid feeds via NSE Data & Analytics. We do not scrape. |
| BSE direct | ❌ **not shipped, by design** | Same reasoning as NSE |

### Per-field notes (Groww provider)

| API field | Groww field | Notes |
|---|---|---|
| `marketPrice` | `last_price` | |
| `previousClose` | derived: `last_price − day_change` | Groww documents no literal previous-close field; exact arithmetic, or `null` |
| `dayHigh` / `dayLow` | `ohlc.high` / `ohlc.low` | |
| `volume` | `volume` | |
| `valueTraded` | — | **`null` by design** — not provided by the Groww quote API |
| `bid` / `ask` | `bid_price` / `offer_price` | |
| `priceTimestamp` | `last_trade_time` | Epoch ms → ISO 8601 |

## Gold price (`/gold`)

| Provider | Status | Source basis |
|---|---|---|
| `null` (default) | ✅ shipped | Null-shaped + reason |
| `metals` | ✅ shipped | [metals.dev](https://metals.dev) — documented API, INR, per-gram. Free tier 100 req/month; 15-min cache keeps one instance within quota |

`pricePerOunce` is converted from the per-gram price using the exact unit definition 1 troy oz = 31.1034768 g — a unit conversion, not an estimate.

## Structurally `null` — summary

These are `null` **by design**, not omissions:

- `valueTraded` under the Groww provider (not in their API)
- All `/market/*` fields under the default `null` provider (no compliant free public source for NSE/BSE quotes exists)
- All `/gold` fields under the default `null` provider (no key configured)
- Any static field whose official source could not be independently verified (per-record; see each record's provenance)
