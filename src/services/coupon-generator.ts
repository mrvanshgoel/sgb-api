// ─── Coupon Schedule Generator ───────────────────────────────────────────
// Generates the deterministic semi-annual coupon schedule for an SGB series
// at DATA BUILD TIME. The stored schedule contains no request-time state
// (no paid/upcoming status) — that is derived per request in derived.ts.
//
// SGBs pay 2.5% per annum on the nominal (issue) value, semi-annually:
// each coupon = faceValue × (interestRate / 2) per unit (gram), rounded
// to the paisa. The final coupon is payable on maturity together with the
// redemption proceeds.

import type { StoredCoupon } from '../types/index.js';

/**
 * Generate the full coupon schedule from issue to maturity (inclusive).
 * Coupon i falls exactly 6×i calendar months after the issue date, each
 * anchored to the issue day-of-month and clamped independently to the last
 * day of the target month (e.g. issue Aug 31 → Feb coupon on 28/29, but
 * the following Aug coupon returns to the 31st).
 */
export function generateCouponSchedule(
  issueDate: string,
  maturityDate: string,
  faceValue: number,
  interestRate: number,
): StoredCoupon[] {
  const amountPerUnit = Math.round(faceValue * (interestRate / 200) * 100) / 100;

  const issue = parseISODate(issueDate);
  const maturity = parseISODate(maturityDate);

  const coupons: StoredCoupon[] = [];
  for (let i = 1; ; i++) {
    const next = addMonthsClamped(issue, 6 * i);
    if (compareDates(next, maturity) > 0) break;
    coupons.push({
      couponNumber: i,
      date: formatDate(next),
      amountPerUnit,
    });
  }

  return coupons;
}

// ─── Date helpers (calendar-only, no timezone involvement) ───────────────
// All SGB dates are civil dates (IST calendar days); we do pure Y/M/D math
// so results are identical regardless of the host machine's timezone.

interface CivilDate {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export function parseISODate(s: string): CivilDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new Error(`Invalid ISO date: ${s}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonthsClamped(date: CivilDate, months: number): CivilDate {
  const totalMonths = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(totalMonths / 12);
  const m = (totalMonths % 12) + 1;
  const d = Math.min(date.d, daysInMonth(y, m));
  return { y, m, d };
}

function compareDates(a: CivilDate, b: CivilDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

function formatDate(date: CivilDate): string {
  return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

/** Add whole years to an ISO date string (used for maturity = issue + 8y). */
export function addYearsISO(dateStr: string, years: number): string {
  const date = parseISODate(dateStr);
  const y = date.y + years;
  const d = Math.min(date.d, daysInMonth(y, date.m));
  return formatDate({ y, m: date.m, d });
}
