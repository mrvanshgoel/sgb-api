// ─── Fastify JSON Schemas ────────────────────────────────────────────────
// Response/request schemas used both for runtime serialization/validation
// and for auto-generating the OpenAPI spec served at /docs.

const nullable = (type: string) => ({ type: [type, 'null'] });

export const couponPaymentJson = {
  type: 'object',
  properties: {
    couponNumber: { type: 'integer' },
    date: { type: 'string', format: 'date' },
    amountPerUnit: { type: 'number' },
    status: { type: 'string', enum: ['paid', 'upcoming'] },
  },
  required: ['couponNumber', 'date', 'amountPerUnit', 'status'],
} as const;

export const provenanceJson = {
  type: 'object',
  properties: {
    lastVerified: { type: 'string', format: 'date' },
    verifiedBy: { type: 'string' },
    sourceDocument: { type: 'string' },
    sourceHash: { type: 'string' },
  },
  required: ['lastVerified', 'verifiedBy', 'sourceDocument', 'sourceHash'],
} as const;

export const derivedFieldsJson = {
  type: 'object',
  description:
    'Deterministic fields derived from the stored coupon schedule and dates. Never price-derived.',
  properties: {
    currentCouponNumber: nullable('integer'),
    nextCouponDate: nullable('string'),
    nextCouponAmount: nullable('number'),
    remainingCoupons: { type: 'integer' },
    totalCoupons: { type: 'integer' },
    interestReceivedPerUnit: { type: 'number' },
    interestRemainingPerUnit: { type: 'number' },
    totalInterestPerUnit: { type: 'number' },
    isMatured: { type: 'boolean' },
    daysToMaturity: nullable('integer'),
    yearsRemaining: nullable('number'),
    prematureRedemptionEligible: { type: 'boolean' },
  },
} as const;

export const sgbRecordJson = {
  type: 'object',
  properties: {
    rbiSeries: { type: 'string' },
    tradingSymbol: { type: 'string' },
    isin: nullable('string'),
    securityCode: nullable('string'),
    issueDate: { type: 'string', format: 'date' },
    subscriptionStart: nullable('string'),
    subscriptionEnd: nullable('string'),
    issuePrice: { type: 'number' },
    onlineDiscountPrice: nullable('number'),
    interestRate: { type: 'number' },
    interestFrequency: { type: 'string', enum: ['semi-annual'] },
    couponSchedule: { type: 'array', items: couponPaymentJson },
    maturityDate: { type: 'string', format: 'date' },
    prematureRedemptionEligibilityDate: { type: 'string', format: 'date' },
    exchange: { type: 'array', items: { type: 'string', enum: ['NSE', 'BSE'] } },
    faceValue: { type: 'number' },
    aliases: { type: 'array', items: { type: 'string' } },
    provenance: provenanceJson,
    derived: derivedFieldsJson,
  },
} as const;

export const marketPriceJson = {
  type: 'object',
  description:
    'Live market data with full provenance. Null-shaped with a reason when no compliant source is available — never an error.',
  properties: {
    symbol: { type: 'string' },
    marketPrice: nullable('number'),
    previousClose: nullable('number'),
    dayHigh: nullable('number'),
    dayLow: nullable('number'),
    volume: nullable('number'),
    valueTraded: nullable('number'),
    bid: nullable('number'),
    ask: nullable('number'),
    priceSource: nullable('string'),
    priceTimestamp: nullable('string'),
    priceDelay: { type: ['string', 'null'], enum: ['Real-time', 'Delayed', null] },
    priceStatus: { type: 'string', enum: ['verified', 'delayed', 'unavailable'] },
    reason: nullable('string'),
  },
} as const;

export const goldPriceJson = {
  type: 'object',
  description:
    'Live gold price from an independent provider. Null-shaped with a reason when unavailable.',
  properties: {
    pricePerGram: nullable('number'),
    pricePerOunce: nullable('number'),
    currency: { type: 'string', enum: ['INR'] },
    timestamp: nullable('string'),
    source: nullable('string'),
    priceStatus: { type: 'string', enum: ['verified', 'delayed', 'unavailable'] },
    reason: nullable('string'),
  },
} as const;

export const errorJson = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'integer' },
  },
} as const;

export const healthJson = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    uptime: { type: 'number' },
    timestamp: { type: 'string' },
    seriesCount: { type: 'integer' },
    marketDataProvider: { type: 'string' },
    goldPriceProvider: { type: 'string' },
    cacheProvider: { type: 'string' },
  },
} as const;

export const lookupResultJson = {
  type: 'object',
  properties: {
    record: { ...sgbRecordJson, type: ['object', 'null'] },
    matchedBy: nullable('string'),
    suggestions: { type: ['array', 'null'], items: sgbRecordJson },
  },
} as const;

export const quoteJson = {
  type: 'object',
  properties: {
    lastPrice: nullable('number'),
    previousClose: nullable('number'),
    change: nullable('number'),
    changePercent: nullable('number'),
    open: nullable('number'),
    high: nullable('number'),
    low: nullable('number'),
    averagePrice: nullable('number'),
    volume: nullable('number'),
    valueTraded: nullable('number'),
    lastUpdated: nullable('string'),
    source: { type: 'string' },
    cached: { type: 'boolean' },
    latencyMs: { type: 'number' },
    liveAvailable: { type: 'boolean' },
    reason: { type: 'string' }
  }
} as const;

export const quoteResponseJson = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    market: quoteJson
  }
} as const;

export const marketDepthJson = {
  type: 'object',
  properties: {
    buyPrice1: nullable('number'), buyQuantity1: nullable('number'),
    buyPrice2: nullable('number'), buyQuantity2: nullable('number'),
    buyPrice3: nullable('number'), buyQuantity3: nullable('number'),
    buyPrice4: nullable('number'), buyQuantity4: nullable('number'),
    buyPrice5: nullable('number'), buyQuantity5: nullable('number'),
    sellPrice1: nullable('number'), sellQuantity1: nullable('number'),
    sellPrice2: nullable('number'), sellQuantity2: nullable('number'),
    sellPrice3: nullable('number'), sellQuantity3: nullable('number'),
    sellPrice4: nullable('number'), sellQuantity4: nullable('number'),
    sellPrice5: nullable('number'), sellQuantity5: nullable('number'),
    totalBuyQuantity: nullable('number'), totalSellQuantity: nullable('number'),
    buySellRatio: nullable('number'), spread: nullable('number')
  }
} as const;

export const tradeInfoJson = {
  type: 'object',
  properties: {
    volume: nullable('number'),
    vwap: nullable('number'),
    previousClose: nullable('number'),
    open: nullable('number'),
    upperCircuit: nullable('number'),
    lowerCircuit: nullable('number'),
    fiftyTwoWeekHigh: nullable('number'),
    fiftyTwoWeekLow: nullable('number'),
    faceValue: nullable('number'),
    series: nullable('string'),
    isin: nullable('string'),
    securityCode: nullable('string')
  }
} as const;

export const financialDerivedJson = {
  type: 'object',
  properties: {
    changePercent: nullable('number'),
    premiumPercent: nullable('number'),
    discountPercent: nullable('number'),
    bidAskSpread: nullable('number'),
    accruedInterest: nullable('number'),
    yieldToMaturity: nullable('number'),
    dirtyPrice: nullable('number'),
    cleanPrice: nullable('number'),
    estimatedFairValue: nullable('number'),
    marketPremiumOverIntrinsic: nullable('number'),
    premiumOverIssue: nullable('number'),
    returnSinceIssue: nullable('number'),
    totalReturn: nullable('number'),
    annualizedReturn: nullable('number')
  }
} as const;

export const combinedLookupJson = {
  type: 'object',
  properties: {
    record: { ...sgbRecordJson, type: ['object', 'null'] },
    market: { type: ['object', 'null'], properties: { quote: quoteJson, depth: marketDepthJson, trade: tradeInfoJson } },
    financial: { ...financialDerivedJson, type: ['object', 'null'] },
    matchedBy: nullable('string'),
    suggestions: { type: ['array', 'null'], items: sgbRecordJson }
  }
} as const;

export const statsJson = {
  type: 'object',
  properties: {
    totalRequests: { type: 'number' },
    cacheHitPercent: { type: 'string' },
    providerLatency: { type: 'number' },
    refreshCount: { type: 'number' },
    failureCount: { type: 'number' },
    cookieAgeSeconds: { type: 'number' },
    uptime: { type: 'number' }
  }
} as const;
