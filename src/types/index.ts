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

export interface MarketDepth {
  buyPrice1: number | null;
  buyQuantity1: number | null;
  buyPrice2: number | null;
  buyQuantity2: number | null;
  buyPrice3: number | null;
  buyQuantity3: number | null;
  buyPrice4: number | null;
  buyQuantity4: number | null;
  buyPrice5: number | null;
  buyQuantity5: number | null;
  sellPrice1: number | null;
  sellQuantity1: number | null;
  sellPrice2: number | null;
  sellQuantity2: number | null;
  sellPrice3: number | null;
  sellQuantity3: number | null;
  sellPrice4: number | null;
  sellQuantity4: number | null;
  sellPrice5: number | null;
  sellQuantity5: number | null;
  totalBuyQuantity: number | null;
  totalSellQuantity: number | null;
  buySellRatio: number | null;
  spread: number | null;
}

export interface TradeInfo {
  volume: number | null;
  vwap: number | null; // volume weighted average price / averagePrice
  previousClose: number | null;
  open: number | null;
  upperCircuit: number | null;
  lowerCircuit: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  faceValue: number | null;
  series: string | null;
  isin: string | null;
  securityCode: string | null;
}

/** Market price result — never throws, always returns this shape */
export interface MarketPriceResult {
  lastPrice: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  averagePrice: number | null;
  volume: number | null;
  valueTraded: number | null;
  lastUpdated: string | null;
  source: string;
  cached: boolean;
  cacheAgeSeconds?: number;
  latencyMs: number;
  liveAvailable: boolean;
  reason?: string;
}

export interface FullMarketData {
  quote: MarketPriceResult;
  depth: MarketDepth;
  trade: TradeInfo;
}

/**
 * SGBAnalyzer valuation analytics, named after the rendered detail page
 * (/sgb/[symbol]) rather than the raw CSV columns. These are VALUATION metrics,
 * not live trades. Percentage fields are expressed as the rendered page shows
 * them (e.g. 2.47 for "2.47%"), i.e. the CSV fraction × 100. Any field the CSV
 * omits stays null — never inferred, estimated, or calculated.
 */
export interface SgbAnalytics {
  symbol: string;
  isin: string | null;
  currentPrice: number | null; // CSV "Ask Price" — best sell-side quote
  fairValue: number | null; // CSV "Fair Value" — computed valuation
  issuePrice: number | null; // CSV "Issue Price"
  discountPercent: number | null; // CSV "Discount to Fair Value" × 100
  yieldYtmPercent: number | null; // CSV "Total Yield to Maturity" × 100
  discountToGoldPercent: number | null; // CSV "Discount to Gold Price" × 100
  yearsToMaturity: number | null; // CSV "Years To Maturity"
  maturity: string | null; // CSV "Maturity Date" (e.g. "Jul 2028")
  interestRate: number | null; // CSV "Interest Payable" — % p.a. (already a percent)
  interestPerUnit: number | null; // CSV "Interest Value"
  nextInterest: string | null; // CSV "Interest Date 1"
  interestDate2: string | null; // CSV "Interest Date 2"
  remainingPayments: number | null; // CSV "No of Remaining Interest Payments"
  totalInterestLeft: number | null; // CSV "Total Remaining Interest"
  pvFutureInterest: number | null; // CSV "Present Value of Future Interest Payments"
  avgTradingVolume: number | null; // CSV "Average Trading Volume" — rolling 7-day average
  source: string;
  cached: boolean;
  reason: string | null; // set when analytics are unavailable for the symbol
}

/** Gold & Silver price result — never throws, always returns this shape */
export interface GoldPriceResult {
  goldPricePerGram: number | null;
  goldPricePerOunce: number | null;
  silverPricePerGram: number | null;
  silverPricePerOunce: number | null;
  currency: 'INR';
  timestamp: string | null;
  source: string | null;
  cached: boolean;
  cacheAgeSeconds?: number;
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

/**
 * Advanced financial calculations requiring live market price.
 */
export interface FinancialDerivedFields {
  changePercent: number | null;
  premiumPercent: number | null;
  discountPercent: number | null;
  bidAskSpread: number | null;
  accruedInterest: number | null;
  yieldToMaturity: number | null;
  dirtyPrice: number | null;
  cleanPrice: number | null;
  estimatedFairValue: number | null;
  marketPremiumOverIntrinsic: number | null;
  premiumOverIssue: number | null;
  returnSinceIssue: number | null;
  totalReturn: number | null;
  annualizedReturn: number | null;
}

/** Full series response: stored record + request-time coupon statuses + derived fields */
export interface SGBRecordResponse extends Omit<SGBRecord, 'couponSchedule'> {
  couponSchedule: CouponPayment[];
  derived: DerivedFields;
}

export interface CombinedLookupResponse {
  record: SGBRecordResponse | null;
  market?: FullMarketData;
  financial?: FinancialDerivedFields;
  matchedBy?: string | null;
  suggestions?: SGBRecord[] | null;
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
