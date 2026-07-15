// ─── Raw Series Input Type ───────────────────────────────────────────────
// Shape of hand-verified entries in raw-series.ts (the human-maintained
// source of truth). scripts/build-data.ts turns these into full records
// with generated coupon schedules.

import type { Provenance } from '../types/index.js';

export interface RawSeries {
  rbiSeries: string;
  tradingSymbol: string;
  isin?: string | null;
  securityCode?: string | null;
  issueDate: string;
  subscriptionStart?: string | null;
  subscriptionEnd?: string | null;
  issuePrice: number;
  onlineDiscountPrice?: number | null;
  /** 2.75 for 2015-16 tranches, 2.5 from 2016-17 Series I onward */
  interestRate: number;
  /** Only set when explicitly stated by the source; else derived issue+8y */
  maturityDate?: string;
  /** Only set when explicitly stated by the source; else derived issue+5y */
  prematureRedemptionEligibilityDate?: string;
  exchange?: ('NSE' | 'BSE')[];
  aliases?: string[];
  provenance: Provenance;
}
