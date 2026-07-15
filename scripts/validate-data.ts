// ─── Data Validation Script ──────────────────────────────────────────────
// CI gate: validates src/data/sgb-series.json against the Zod schema plus
// structural invariants beyond the schema (coupon math, date ordering).
// Run: npm run validate:data

import { readFileSync } from 'node:fs';
import { sgbSeriesFileSchema } from '../src/types/schemas.js';

const DATA_PATH = 'src/data/sgb-series.json';

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

let raw: string;
try {
  raw = readFileSync(DATA_PATH, 'utf-8');
} catch {
  fail(`Cannot read ${DATA_PATH} — run 'npm run build:data' first`);
}

let json: unknown;
try {
  json = JSON.parse(raw);
} catch (e) {
  fail(`${DATA_PATH} is not valid JSON: ${(e as Error).message}`);
}

const parsed = sgbSeriesFileSchema.safeParse(json);
if (!parsed.success) {
  console.error('❌ Schema validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const { series } = parsed.data;
const errors: string[] = [];

for (const r of series) {
  const tag = `${r.rbiSeries} (${r.tradingSymbol})`;

  // Date ordering invariants
  if (r.subscriptionStart && r.subscriptionEnd && r.subscriptionStart > r.subscriptionEnd) {
    errors.push(`${tag}: subscriptionStart after subscriptionEnd`);
  }
  if (r.issueDate >= r.maturityDate) errors.push(`${tag}: issueDate not before maturityDate`);
  if (
    r.prematureRedemptionEligibilityDate <= r.issueDate ||
    r.prematureRedemptionEligibilityDate >= r.maturityDate
  ) {
    errors.push(`${tag}: premature redemption date not between issue and maturity`);
  }

  // Coupon schedule invariants
  const expectedCoupon = Math.round(r.faceValue * (r.interestRate / 200) * 100) / 100;
  for (const c of r.couponSchedule) {
    if (c.amountPerUnit !== expectedCoupon) {
      errors.push(
        `${tag}: coupon ${c.couponNumber} amount ${c.amountPerUnit} ≠ expected ${expectedCoupon}`,
      );
      break;
    }
  }
  const nums = r.couponSchedule.map((c) => c.couponNumber);
  if (!nums.every((n, i) => n === i + 1)) errors.push(`${tag}: coupon numbers not sequential`);
  const dates = r.couponSchedule.map((c) => c.date);
  if (!dates.every((d, i) => i === 0 || d > dates[i - 1])) {
    errors.push(`${tag}: coupon dates not strictly increasing`);
  }
  const last = dates[dates.length - 1];
  if (last !== r.maturityDate) {
    errors.push(`${tag}: final coupon ${last} does not fall on maturity ${r.maturityDate}`);
  }

  // Online discount sanity: if present, must be issuePrice - 50
  if (r.onlineDiscountPrice !== null && r.issuePrice - r.onlineDiscountPrice !== 50) {
    errors.push(
      `${tag}: onlineDiscountPrice ${r.onlineDiscountPrice} is not issuePrice - 50 (${r.issuePrice - 50})`,
    );
  }

  // Provenance must not point at placeholder/example domains
  if (/example\.com|localhost|placeholder/i.test(r.provenance.sourceDocument)) {
    errors.push(`${tag}: provenance.sourceDocument is a placeholder URL`);
  }
}

// Duplicate security codes (schema already covers symbol/ISIN)
const codes = series.map((r) => r.securityCode).filter((c): c is string => c !== null);
if (new Set(codes).size !== codes.length) errors.push('Duplicate securityCode found');

if (errors.length > 0) {
  console.error(`❌ ${errors.length} data validation error(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}

console.log(`✅ ${DATA_PATH} valid — ${series.length} series, all invariants hold`);
