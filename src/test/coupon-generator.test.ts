// ─── Unit Tests: Coupon Schedule Generation ──────────────────────────────
// Deterministic math — test exact values.

import { describe, it, expect } from 'vitest';
import { generateCouponSchedule, addYearsISO } from '../services/coupon-generator.js';

describe('generateCouponSchedule', () => {
  it('generates 16 semi-annual coupons for an 8-year bond', () => {
    const schedule = generateCouponSchedule('2020-07-06', '2028-07-06', 4852, 2.5);
    expect(schedule).toHaveLength(16);
  });

  it('computes exact coupon amount: faceValue × rate/2, rounded to paisa', () => {
    // 4852 × 0.0125 = 60.65 exactly
    const schedule = generateCouponSchedule('2020-07-06', '2028-07-06', 4852, 2.5);
    for (const c of schedule) expect(c.amountPerUnit).toBe(60.65);
  });

  it('rounds odd amounts to 2 decimal places', () => {
    // 3119 × 0.01375 (2.75% rate) = 42.88625 → 42.89
    const schedule = generateCouponSchedule('2016-08-05', '2024-08-05', 3119, 2.75);
    expect(schedule[0].amountPerUnit).toBe(42.89);
  });

  it('spaces coupons exactly 6 calendar months apart, ending on maturity', () => {
    const schedule = generateCouponSchedule('2020-07-06', '2028-07-06', 4852, 2.5);
    expect(schedule[0].date).toBe('2021-01-06');
    expect(schedule[1].date).toBe('2021-07-06');
    expect(schedule[15].date).toBe('2028-07-06'); // final coupon on maturity
  });

  it('numbers coupons sequentially from 1', () => {
    const schedule = generateCouponSchedule('2020-07-06', '2028-07-06', 4852, 2.5);
    expect(schedule.map((c) => c.couponNumber)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it('clamps month-end overflow (Aug 31 + 6mo → Feb 28/29)', () => {
    const schedule = generateCouponSchedule('2020-08-31', '2028-08-31', 5000, 2.5);
    expect(schedule[0].date).toBe('2021-02-28'); // 2021 not a leap year
    // 2024 IS a leap year: coupon 7 lands Feb 2024
    const feb2024 = schedule.find((c) => c.date.startsWith('2024-02'));
    expect(feb2024?.date).toBe('2024-02-29');
  });

  it('is timezone-independent (pure calendar math)', () => {
    const a = generateCouponSchedule('2015-11-30', '2023-11-30', 2684, 2.75);
    expect(a[0].date).toBe('2016-05-30');
    expect(a).toHaveLength(16);
  });

  it('contains no request-time state (no status field)', () => {
    const schedule = generateCouponSchedule('2020-07-06', '2028-07-06', 4852, 2.5);
    expect(schedule[0]).not.toHaveProperty('status');
  });
});

describe('addYearsISO', () => {
  it('adds whole years', () => {
    expect(addYearsISO('2020-07-06', 8)).toBe('2028-07-06');
    expect(addYearsISO('2020-07-06', 5)).toBe('2025-07-06');
  });

  it('clamps Feb 29 → Feb 28 in non-leap target years', () => {
    expect(addYearsISO('2024-02-29', 8)).toBe('2032-02-29'); // 2032 is leap
    expect(addYearsISO('2024-02-29', 5)).toBe('2029-02-28'); // 2029 is not
  });
});
