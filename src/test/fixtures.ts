// ─── Test Fixtures ───────────────────────────────────────────────────────
// SYNTHETIC records for testing only. These are NOT real SGB data and are
// never shipped in sgb-series.json. Values chosen for easy mental math.

import type { SGBRecord } from '../types/index.js';
import { generateCouponSchedule } from '../services/coupon-generator.js';

const FIXTURE_PROVENANCE = {
  lastVerified: '2026-01-01',
  verifiedBy: 'test-fixture',
  sourceDocument: 'https://example.com/test-fixture-not-real',
  sourceHash: 'sha256:' + 'a'.repeat(64),
};

/** Issue 2020-01-15, matures 2028-01-15, price 4000 → coupon 50.00 */
export const fixtureA: SGBRecord = {
  rbiSeries: '2019-20 Series IX',
  tradingSymbol: 'SGBTESTA',
  isin: 'IN0020TEST01',
  securityCode: '800001',
  issueDate: '2020-01-15',
  subscriptionStart: '2020-01-06',
  subscriptionEnd: '2020-01-10',
  issuePrice: 4000,
  onlineDiscountPrice: 3950,
  interestRate: 2.5,
  interestFrequency: 'semi-annual',
  couponSchedule: generateCouponSchedule('2020-01-15', '2028-01-15', 4000, 2.5),
  maturityDate: '2028-01-15',
  prematureRedemptionEligibilityDate: '2025-01-15',
  exchange: ['NSE', 'BSE'],
  faceValue: 4000,
  aliases: ['SGB 2019-20 IX', 'TEST BOND A'],
  provenance: FIXTURE_PROVENANCE,
};

/** Already matured: issued 2016-08-05, matured 2024-08-05 */
export const fixtureB: SGBRecord = {
  rbiSeries: '2016-17 Series I',
  tradingSymbol: 'SGBTESTB',
  isin: 'IN0020TEST02',
  securityCode: '800002',
  issueDate: '2016-08-05',
  subscriptionStart: null,
  subscriptionEnd: null,
  issuePrice: 3119,
  onlineDiscountPrice: null,
  interestRate: 2.75,
  interestFrequency: 'semi-annual',
  couponSchedule: generateCouponSchedule('2016-08-05', '2024-08-05', 3119, 2.75),
  maturityDate: '2024-08-05',
  prematureRedemptionEligibilityDate: '2021-08-05',
  exchange: ['NSE'],
  faceValue: 3119,
  aliases: [],
  provenance: FIXTURE_PROVENANCE,
};

/** Null identifiers (unverified ISIN/security code) */
export const fixtureC: SGBRecord = {
  rbiSeries: '2023-24 Series IV',
  tradingSymbol: 'SGBTESTC',
  isin: null,
  securityCode: null,
  issueDate: '2024-02-21',
  subscriptionStart: '2024-02-12',
  subscriptionEnd: '2024-02-16',
  issuePrice: 6263,
  onlineDiscountPrice: 6213,
  interestRate: 2.5,
  interestFrequency: 'semi-annual',
  couponSchedule: generateCouponSchedule('2024-02-21', '2032-02-21', 6263, 2.5),
  maturityDate: '2032-02-21',
  prematureRedemptionEligibilityDate: '2029-02-21',
  exchange: ['NSE', 'BSE'],
  faceValue: 6263,
  aliases: [],
  provenance: FIXTURE_PROVENANCE,
};

export const allFixtures: SGBRecord[] = [fixtureA, fixtureB, fixtureC];
