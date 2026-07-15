# Contributing

Thanks for helping! This project has one non-negotiable rule:

> **No data enters the dataset without a source citation. Never fabricate, estimate, or guess a value. When in doubt, `null`.**

## Adding or correcting an SGB series record

Series data lives in `src/data/raw-series.ts`. Each entry needs:

1. **A `sourceDocument` URL** — the exact RBI press release or notification the record was verified against (e.g. `https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=...`). Archived copies of official pages (web.archive.org) are acceptable for identifiers (ISIN/symbol/scrip code) when the live page is inaccessible — cite the archive URL.
2. **A `sourceHash`** — SHA-256 of the source document, for drift detection:
   ```bash
   curl -s '<sourceDocument-url>' | sha256sum
   # → put "sha256:<hex>" in the record
   ```
3. **`lastVerified`** — the date you checked the record against the source.
4. **`verifiedBy`** — your GitHub username.

Then regenerate and validate:

```bash
npm run build:data      # regenerates sgb-series.json (incl. coupon schedules)
npm run validate:data   # must pass — CI runs this on every PR
npm test
```

### What the validator enforces

- Zod schema: required fields, ISIN format (`IN` + 10 alphanumeric), date formats, provenance block present on **every** record
- No duplicate trading symbols, ISINs, or security codes
- Coupon amounts exactly equal `faceValue × interestRate/200` (rounded to the paisa)
- Coupon dates strictly increasing, final coupon on maturity date
- `onlineDiscountPrice`, when present, is exactly `issuePrice − 50`
- No placeholder URLs in provenance

### Field rules

- **Unverifiable field → `null`.** Do not copy values from finance blogs, aggregator sites, or other unofficial sources. Acceptable sources: rbi.org.in, nseindia.com, bseindia.com (or their archive.org captures).
- Coupon schedules are **generated, not hand-entered** — never edit `sgb-series.json` directly; it's a build artifact of `raw-series.ts`.
- Interest rate is 2.5% for all tranches from 2016-17 Series I onward; the earlier 2015-16 tranches were 2.75%. If you're adding an early tranche, verify the rate in the RBI notification — don't assume.

## Adding a provider

Implement one of the interfaces in `src/providers/interfaces.ts`:

- `MarketPriceProvider` / `GoldProvider` — **must never throw.** Return `nullMarketResult(reason)` / `nullGoldResult(reason)` on every failure path. Include `priceSource`, `priceTimestamp`, and `priceDelay` provenance on success.
- Only integrate **officially documented** APIs used with the **user's own credentials**. Scrapers of bot-protected endpoints will not be merged.
- Add provider tests covering: missing credentials, HTTP errors, network failures, malformed responses, and the happy-path field mapping (mock `fetch` — see `src/test/providers.test.ts`).
- Wire it into `src/container.ts` behind an env option and document it in `.env.example`, `README.md`, and `DATA_SOURCES.md`.

## PR checklist

- [ ] `npm run lint` passes
- [ ] `npm run validate:data` passes
- [ ] `npm test` passes
- [ ] New data records cite an official `sourceDocument` + `sourceHash`
- [ ] No fabricated, estimated, or price-predictive values anywhere
