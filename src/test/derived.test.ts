// ─── Unit Tests: Derived Fields (interest accounting, countdowns) ────────
// All calls pass an explicit `today` so results are exact and stable.

import { describe, it, expect } from 'vitest';
import { deriveFields, couponsWithStatus, daysBetween, toSeriesResponse } from '../services/derived.js';
import { fixtureA, fixtureB } from './fixtures.js';

// fixtureA: issued 2020-01-15, matures 2028-01-15, price 4000 → coupon 50.00 × 16

describe('daysBetween', () => {
  it('computes exact day counts', () => {
    expect(daysBetween('2026-07-15', '2026-07-16')).toBe(1);
    expect(daysBetween('2026-07-15', '2028-01-15')).toBe(549);
    expect(daysBetween('2026-07-15', '2026-07-15')).toBe(0);
  });

  it('handles leap years exactly', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1); // non-leap
  });
});

describe('couponsWithStatus', () => {
  it('marks past and today-dated coupons paid, future upcoming', () => {
    const coupons = couponsWithStatus(fixtureA, '2023-07-15');
    // Coupons: 2020-07-15, 2021-01-15, ..., paid through 2023-07-15 (today = paid)
    const paid = coupons.filter((c) => c.status === 'paid');
    expect(paid).toHaveLength(7); // Jul20,Jan21,Jul21,Jan22,Jul22,Jan23,Jul23
    expect(coupons[7].status).toBe('upcoming');
  });
});

describe('deriveFields — active bond', () => {
  const d = deriveFields(fixtureA, '2026-07-15');
  // paid coupons: Jul20..Jan26+Jul26? — 2026-07-15 coupon date IS today → paid
  // schedule dates: 2020-07-15(1) ... every 6mo ... 2028-01-15(16)

  it('counts paid coupons exactly', () => {
    expect(d.currentCouponNumber).toBe(13); // 2026-07-15 is coupon #13, paid today
  });

  it('finds next coupon by lookup, not recomputation', () => {
    expect(d.nextCouponDate).toBe('2027-01-15');
    expect(d.nextCouponAmount).toBe(50);
  });

  it('computes exact interest accounting', () => {
    expect(d.totalCoupons).toBe(16);
    expect(d.remainingCoupons).toBe(3);
    expect(d.interestReceivedPerUnit).toBe(650); // 13 × 50
    expect(d.interestRemainingPerUnit).toBe(150); // 3 × 50
    expect(d.totalInterestPerUnit).toBe(800); // 16 × 50
  });

  it('computes exact maturity countdown', () => {
    expect(d.isMatured).toBe(false);
    expect(d.daysToMaturity).toBe(549);
    expect(d.yearsRemaining).toBe(1.5); // 549/365.25 = 1.5031 → 1.5
  });

  it('flags premature redemption eligibility (5y mark passed)', () => {
    expect(d.prematureRedemptionEligible).toBe(true); // eligible 2025-01-15
  });
});

describe('deriveFields — matured bond', () => {
  const d = deriveFields(fixtureB, '2026-07-15'); // matured 2024-08-05

  it('reports matured with null countdowns', () => {
    expect(d.isMatured).toBe(true);
    expect(d.daysToMaturity).toBeNull();
    expect(d.yearsRemaining).toBeNull();
    expect(d.nextCouponDate).toBeNull();
    expect(d.nextCouponAmount).toBeNull();
    expect(d.remainingCoupons).toBe(0);
  });

  it('reports full interest received', () => {
    expect(d.interestReceivedPerUnit).toBe(d.totalInterestPerUnit);
    expect(d.interestRemainingPerUnit).toBe(0);
    // 3119 × 0.01375 = 42.88625 → 42.89 × 16 = 686.24
    expect(d.totalInterestPerUnit).toBe(686.24);
  });

  it('premature redemption not applicable once matured', () => {
    expect(d.prematureRedemptionEligible).toBe(false);
  });
});

describe('deriveFields — brand new bond (no coupons paid)', () => {
  it('returns null currentCouponNumber before first coupon', () => {
    const d = deriveFields(fixtureA, '2020-02-01');
    expect(d.currentCouponNumber).toBeNull();
    expect(d.interestReceivedPerUnit).toBe(0);
    expect(d.nextCouponDate).toBe('2020-07-15');
    expect(d.prematureRedemptionEligible).toBe(false);
  });
});

describe('toSeriesResponse', () => {
  it('combines record, statused coupons, and derived fields', () => {
    const res = toSeriesResponse(fixtureA, '2026-07-15');
    expect(res.tradingSymbol).toBe('SGBTESTA');
    expect(res.couponSchedule[0].status).toBe('paid');
    expect(res.derived.totalCoupons).toBe(16);
    expect(res.provenance.sourceDocument).toContain('example.com');
  });
});
