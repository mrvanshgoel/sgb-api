// ─── Build SGB Data ─────────────────────────────────────────────────────
// Generates src/data/sgb-series.json from src/data/raw-series.ts.
// Coupon schedules are generated ONCE here (deterministic: face value ×
// rate ÷ frequency) and stored on each record — request-time code only
// does lookups over the stored schedule.
//
// Run: npm run build:data

import { writeFileSync } from 'node:fs';
import { generateCouponSchedule, addYearsISO } from '../src/services/coupon-generator.js';
import { rawSeries } from '../src/data/raw-series.js';

const OUTPUT = 'src/data/sgb-series.json';
const GENERATED_DATE = new Date().toISOString().split('T')[0];

const series = rawSeries.map((raw) => {
  // Maturity is 8 years from issue; premature redemption from the 5th year.
  // Prefer explicitly verified dates from the RBI source when present.
  const maturityDate = raw.maturityDate ?? addYearsISO(raw.issueDate, 8);
  const prematureDate = raw.prematureRedemptionEligibilityDate ?? addYearsISO(raw.issueDate, 5);

  return {
    rbiSeries: raw.rbiSeries,
    tradingSymbol: raw.tradingSymbol,
    isin: raw.isin ?? null,
    securityCode: raw.securityCode ?? null,
    issueDate: raw.issueDate,
    subscriptionStart: raw.subscriptionStart ?? null,
    subscriptionEnd: raw.subscriptionEnd ?? null,
    issuePrice: raw.issuePrice,
    onlineDiscountPrice: raw.onlineDiscountPrice ?? null,
    interestRate: raw.interestRate,
    interestFrequency: 'semi-annual' as const,
    couponSchedule: generateCouponSchedule(raw.issueDate, maturityDate, raw.issuePrice, raw.interestRate),
    maturityDate,
    prematureRedemptionEligibilityDate: prematureDate,
    exchange: raw.exchange ?? (['NSE', 'BSE'] as ('NSE' | 'BSE')[]),
    faceValue: raw.issuePrice,
    aliases: raw.aliases ?? [],
    provenance: raw.provenance,
  };
});

const data = {
  version: '1.0.0',
  generatedAt: GENERATED_DATE,
  totalSeries: series.length,
  series,
};

writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
console.log(`✅ Generated ${series.length} SGB series → ${OUTPUT}`);
console.log(`   Date: ${GENERATED_DATE}`);
console.log(`   Next: npm run validate:data`);
