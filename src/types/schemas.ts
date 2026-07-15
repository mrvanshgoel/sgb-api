// ─── Zod Validation Schemas ─────────────────────────────────────────────
// Used for: validating sgb-series.json at build/CI time and in tests.
// (Runtime request validation uses Fastify JSON schemas in the routes.)

import { z } from 'zod';

/** GoI SGB ISINs start with IN0020; accept IN + 10 alphanumeric */
export const isinSchema = z
  .string()
  .regex(/^IN[A-Z0-9]{10}$/, 'ISIN must match pattern IN + 10 alphanumeric chars (e.g. IN0020200245)');

/** ISO date string */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date format YYYY-MM-DD');

/** Stored coupon schema (no request-time status — that is derived per request) */
export const storedCouponSchema = z.object({
  couponNumber: z.number().int().positive(),
  date: isoDateSchema,
  amountPerUnit: z.number().nonnegative(),
});

/** Provenance schema — required on every record, no exceptions */
export const provenanceSchema = z.object({
  lastVerified: isoDateSchema,
  verifiedBy: z.string().min(1),
  sourceDocument: z.string().url('sourceDocument must be a valid URL'),
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/, 'sourceHash must be sha256: followed by 64 hex chars'),
});

/** Full SGB record schema */
export const sgbRecordSchema = z.object({
  rbiSeries: z.string().min(1),
  tradingSymbol: z.string().min(1),
  isin: isinSchema.nullable(),
  securityCode: z.string().min(1).nullable(),
  issueDate: isoDateSchema,
  subscriptionStart: isoDateSchema.nullable(),
  subscriptionEnd: isoDateSchema.nullable(),
  issuePrice: z.number().positive(),
  onlineDiscountPrice: z.number().nonnegative().nullable(),
  interestRate: z.number(),
  interestFrequency: z.literal('semi-annual'),
  couponSchedule: z.array(storedCouponSchema).min(1),
  maturityDate: isoDateSchema,
  prematureRedemptionEligibilityDate: isoDateSchema,
  exchange: z.array(z.enum(['NSE', 'BSE'])).min(1),
  faceValue: z.number().positive(),
  aliases: z.array(z.string()),
  provenance: provenanceSchema,
});

/** Schema for the entire sgb-series.json file */
export const sgbSeriesFileSchema = z
  .object({
    version: z.string(),
    generatedAt: isoDateSchema,
    totalSeries: z.number().int().positive(),
    series: z
      .array(sgbRecordSchema)
      .min(1)
      .refine(
        (records) => {
          const symbols = records.map((r) => r.tradingSymbol);
          return new Set(symbols).size === symbols.length;
        },
        { message: 'Duplicate tradingSymbol found in series data' },
      )
      .refine(
        (records) => {
          const isins = records.map((r) => r.isin).filter((i): i is string => i !== null);
          return new Set(isins).size === isins.length;
        },
        { message: 'Duplicate ISIN found in series data' },
      ),
  })
  .refine((file) => file.totalSeries === file.series.length, {
    message: 'totalSeries does not match series array length',
  });

/** Search query schema */
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  exchange: z.enum(['NSE', 'BSE']).optional(),
  maturityYear: z.coerce.number().int().min(2015).max(2040).optional(),
  issueYear: z.coerce.number().int().min(2015).max(2030).optional(),
  activeOnly: z.coerce.boolean().default(false).optional(),
});

/** Market price result schema */
export const marketPriceResultSchema = z.object({
  marketPrice: z.number().nullable(),
  previousClose: z.number().nullable(),
  dayHigh: z.number().nullable(),
  dayLow: z.number().nullable(),
  volume: z.number().nullable(),
  valueTraded: z.number().nullable(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  priceSource: z.string().nullable(),
  priceTimestamp: z.string().nullable(),
  priceDelay: z.enum(['Real-time', 'Delayed']).nullable(),
  priceStatus: z.enum(['verified', 'delayed', 'unavailable']),
  reason: z.string().nullable(),
});

/** Gold price result schema */
export const goldPriceResultSchema = z.object({
  pricePerGram: z.number().nullable(),
  pricePerOunce: z.number().nullable(),
  currency: z.literal('INR'),
  timestamp: z.string().nullable(),
  source: z.string().nullable(),
  priceStatus: z.enum(['verified', 'delayed', 'unavailable']),
  reason: z.string().nullable(),
});

export type SGBRecordDTO = z.infer<typeof sgbRecordSchema>;
export type SearchQueryDTO = z.infer<typeof searchQuerySchema>;
export type MarketPriceResultDTO = z.infer<typeof marketPriceResultSchema>;
export type GoldPriceResultDTO = z.infer<typeof goldPriceResultSchema>;
