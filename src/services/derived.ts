// ─── Derived Fields (deterministic, request-time) ────────────────────────
// Everything here is a pure lookup/count over the stored coupon schedule
// plus calendar math against "today" (IST). No market prices, no external
// data, no recomputation of the schedule itself.

import type {
  SGBRecord,
  SGBRecordResponse,
  CouponPayment,
  DerivedFields,
} from '../types/index.js';

/** Current civil date in IST as YYYY-MM-DD (SGB events are IST calendar days). */
export function todayIST(now: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Days between two ISO dates (b - a), pure calendar arithmetic via UTC. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const utcA = Date.UTC(ay, am - 1, ad);
  const utcB = Date.UTC(by, bm - 1, bd);
  return Math.round((utcB - utcA) / 86_400_000);
}

/** Attach request-time status to each stored coupon. */
export function couponsWithStatus(record: SGBRecord, today: string): CouponPayment[] {
  return record.couponSchedule.map((c) => ({
    ...c,
    status: c.date <= today ? ('paid' as const) : ('upcoming' as const),
  }));
}

/** Compute all deterministic derived fields for a series. */
export function deriveFields(record: SGBRecord, today: string = todayIST()): DerivedFields {
  const schedule = record.couponSchedule;
  const paid = schedule.filter((c) => c.date <= today);
  const upcoming = schedule.filter((c) => c.date > today);
  const next = upcoming[0] ?? null;

  const isMatured = record.maturityDate <= today;
  const daysToMaturity = isMatured ? null : daysBetween(today, record.maturityDate);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    currentCouponNumber: paid.length > 0 ? paid[paid.length - 1].couponNumber : null,
    nextCouponDate: next?.date ?? null,
    nextCouponAmount: next?.amountPerUnit ?? null,
    remainingCoupons: upcoming.length,
    totalCoupons: schedule.length,
    interestReceivedPerUnit: round2(paid.reduce((s, c) => s + c.amountPerUnit, 0)),
    interestRemainingPerUnit: round2(upcoming.reduce((s, c) => s + c.amountPerUnit, 0)),
    totalInterestPerUnit: round2(schedule.reduce((s, c) => s + c.amountPerUnit, 0)),
    isMatured,
    daysToMaturity,
    yearsRemaining: daysToMaturity === null ? null : round2(daysToMaturity / 365.25),
    prematureRedemptionEligible:
      !isMatured && record.prematureRedemptionEligibilityDate <= today,
  };
}

/** Full API response shape for a series: record + statused coupons + derived. */
export function toSeriesResponse(record: SGBRecord, today: string = todayIST()): SGBRecordResponse {
  return {
    ...record,
    couponSchedule: couponsWithStatus(record, today),
    derived: deriveFields(record, today),
  };
}
