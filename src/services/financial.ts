import type { 
  SGBRecord, 
  MarketPriceResult, 
  MarketDepth, 
  FinancialDerivedFields,
  DerivedFields
} from '../types/index.js';
import { daysBetween, todayIST } from './derived.js';

export function calculateFinancials(
  record: SGBRecord,
  quote: MarketPriceResult,
  depth: MarketDepth,
  derived: DerivedFields,
  today: string = todayIST()
): FinancialDerivedFields {
  const ltp = quote.lastPrice;
  const issuePrice = record.issuePrice;
  
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Change %
  const changePercent = quote.changePercent ?? null;

  // Premium / Discount
  let premiumPercent: number | null = null;
  let discountPercent: number | null = null;
  let premiumOverIssue: number | null = null;
  
  if (ltp !== null && issuePrice) {
    premiumOverIssue = round2(ltp - issuePrice);
    premiumPercent = round2((premiumOverIssue / issuePrice) * 100);
    discountPercent = premiumPercent < 0 ? Math.abs(premiumPercent) : 0;
  }

  // Bid / Ask Spread
  const bidAskSpread = depth.spread ?? null;

  // Accrued Interest
  let accruedInterest: number | null = null;
  if (!derived.isMatured) {
    // SGB pays interest semi-annually.
    // Calculate days since last coupon or issue date
    const schedule = record.couponSchedule;
    const paid = schedule.filter(c => c.date <= today);
    const lastPaymentDate = paid.length > 0 ? paid[paid.length - 1].date : record.issueDate;
    
    const daysSinceLastPayment = daysBetween(lastPaymentDate, today);
    // Interest formula: Face Value (or Issue Price) * 2.5% * (days / 365)
    // SGB interest is typically calculated on the initial investment (issue price).
    accruedInterest = round2(issuePrice * (record.interestRate / 100) * (Math.max(0, daysSinceLastPayment) / 365));
  } else {
    accruedInterest = 0;
  }

  // Dirty / Clean Price
  // SGBs trade "dirty" on the exchange (price includes accrued interest).
  let dirtyPrice: number | null = null;
  let cleanPrice: number | null = null;
  
  if (ltp !== null) {
    dirtyPrice = ltp;
    cleanPrice = accruedInterest !== null ? round2(dirtyPrice - accruedInterest) : null;
  }

  // Yield to Maturity (approximate)
  let yieldToMaturity: number | null = null;
  if (ltp !== null && !derived.isMatured && derived.yearsRemaining && derived.yearsRemaining > 0) {
    const C = issuePrice * (record.interestRate / 100);
    const F = ltp; // approximating redemption at current market price or issue price? Actually redemption is at prevailing gold price.
    // Since redemption price is unknown (tied to future gold price), YTM is usually calculated assuming redemption at current market price (LTP).
    const redemptionPrice = ltp; 
    
    // YTM approx = [C + (F - P)/n] / [(F + P)/2]
    // where C = coupon, F = face/redemption, P = price, n = years
    const P = ltp;
    const n = derived.yearsRemaining;
    
    const ytm = (C + (redemptionPrice - P) / n) / ((redemptionPrice + P) / 2);
    yieldToMaturity = round2(ytm * 100);
  }

  // Return since issue
  let returnSinceIssue: number | null = null;
  let totalReturn: number | null = null;
  let annualizedReturn: number | null = null;
  
  if (ltp !== null && issuePrice) {
    returnSinceIssue = premiumOverIssue; // capital appreciation
    totalReturn = round2((returnSinceIssue ?? 0) + derived.interestReceivedPerUnit);
    
    const daysSinceIssue = daysBetween(record.issueDate, today);
    if (daysSinceIssue > 0) {
      const yearsSinceIssue = daysSinceIssue / 365.25;
      // CAGR
      annualizedReturn = round2((Math.pow((ltp + derived.interestReceivedPerUnit) / issuePrice, 1 / yearsSinceIssue) - 1) * 100);
    }
  }

  return {
    changePercent,
    premiumPercent,
    discountPercent,
    bidAskSpread,
    accruedInterest,
    yieldToMaturity,
    dirtyPrice,
    cleanPrice,
    estimatedFairValue: null, // Requires live gold price provider integration
    marketPremiumOverIntrinsic: null, // Requires live gold price
    premiumOverIssue,
    returnSinceIssue,
    totalReturn,
    annualizedReturn
  };
}
