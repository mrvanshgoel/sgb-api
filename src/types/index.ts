// ─── SGB API Type Definitions ────────────────────────────────────────────
// All types are defined here as plain interfaces for use across the codebase.
// Zod validation schemas are in schemas.ts.

/** Coupon entry as stored in sgb-series.json — deterministic, never expires */
export interface StoredCoupon {
  couponNumber: number;
  date: string; // ISO date string (YYYY-MM-DD)
  amountPerUnit: number; // INR per gram of gold
}

/**
 * Coupon payment as served by the API. `status` is derived at request time
 * from the current date (a static file must never bake in "paid"/"upcoming"
 * — it would go stale the day after generation).
 */
export interface CouponPayment extends StoredCoupon {
  status: 'paid' | 'upcoming';
}

/** Provenance / audit trail for a single SGB record */
export interface Provenance {
  lastVerified: string; // ISO date string
  verifiedBy: string;
  sourceDocument: string; // URL to RBI notification
  sourceHash: string; // sha256:... of source document
}

/** Complete record for a single SGB series */
export interface SGBRecord {
  rbiSeries: string; // e.g. "2020-21 Series IV"
  tradingSymbol: string; // e.g. "SGBJUL28IV"
  isin: string | null; // e.g. "IN0020200245" (GoI security — IN0020 prefix); null if unverified
  securityCode: string | null; // BSE scrip code, e.g. "800100"; null if unverified
  issueDate: string; // ISO date string
  subscriptionStart: string | null;
  subscriptionEnd: string | null;
  issuePrice: number; // per gram INR
  onlineDiscountPrice: number | null; // per gram INR (₹50 discount typically)
  interestRate: number; // always 2.5
  interestFrequency: 'semi-annual';
  couponSchedule: StoredCoupon[];
  maturityDate: string;
  prematureRedemptionEligibilityDate: string;
  exchange: ('NSE' | 'BSE')[];
  faceValue: number;
  aliases: string[];
  provenance: Provenance;
}

/** Market price result — never throws, always returns this shape */
export interface MarketPriceResult {
  marketPrice: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  valueTraded: number | null;
  bid: number | null;
  ask: number | null;
  priceSource: string | null;
  priceTimestamp: string | null;
  priceDelay: 'Real-time' | 'Delayed' | null;
  priceStatus: 'verified' | 'delayed' | 'unavailable';
  reason: string | null;
}

/** Gold price result — never throws, always returns this shape */
export interface GoldPriceResult {
  pricePerGram: number | null;
  pricePerOunce: number | null;
  currency: 'INR';
  timestamp: string | null;
  source: string | null;
  priceStatus: 'verified' | 'delayed' | 'unavailable';
  reason: string | null;
}

/** Response for the /lookup endpoint */
export interface LookupResult {
  record: SGBRecord | null;
  matchedBy: string | null; // e.g. "tradingSymbol", "isin", "seriesName"
  suggestions: SGBRecord[] | null; // populated when no confident match
}

/**
 * Deterministic fields derived at request time from the stored coupon
 * schedule and dates — pure lookups/counts, never price-derived.
 */
export interface DerivedFields {
  currentCouponNumber: number | null; // last coupon already paid; null if none yet
  nextCouponDate: string | null; // null once matured
  nextCouponAmount: number | null;
  remainingCoupons: number;
  totalCoupons: number;
  interestReceivedPerUnit: number; // sum of paid coupons, INR per gram
  interestRemainingPerUnit: number; // sum of upcoming coupons, INR per gram
  totalInterestPerUnit: number; // full-schedule sum, INR per gram
  isMatured: boolean;
  daysToMaturity: number | null; // null once matured
  yearsRemaining: number | null; // days/365.25 rounded to 2dp; null once matured
  prematureRedemptionEligible: boolean;
}

/** Full series response: stored record + request-time coupon statuses + derived fields */
export interface SGBRecordResponse extends Omit<SGBRecord, 'couponSchedule'> {
  couponSchedule: CouponPayment[];
  derived: DerivedFields;
}

/** Search filter options */
export interface SearchFilters {
  exchange?: 'NSE' | 'BSE';
  maturityYear?: number;
  issueYear?: number;
  interestRate?: number;
  activeOnly?: boolean;
}

/** Health check response */
export interface HealthResult {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  seriesCount: number;
  marketDataProvider: string;
  goldPriceProvider: string;
  cacheProvider: string;
}
