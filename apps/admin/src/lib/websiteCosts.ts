/** Demo rate card for Aurora variable pricing (EUR / month). */
export const WEBSITE_COST_RATES = {
  websitePerMonthEur: 49,
  seatPerMonthEur: 15,
  perThousandPageViewsEur: 0.5,
} as const;

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Stable illustrative usage for a website until real metering exists. */
export function estimateWebsiteUsage(websiteId: string) {
  const seed = hashSeed(websiteId || "default");
  const pageViews = 18_000 + (seed % 90_000);
  const aiTokens = 80_000 + (seed % 420_000);
  /** Rough blended provider rate (~$0.50 / 1M tokens → €0.0005 / 1k). */
  const aiProviderEurPer1kTokens = 0.012;
  const aiProviderEstimateEur =
    Math.round((aiTokens / 1000) * aiProviderEurPer1kTokens * 100) / 100;

  return {
    pageViews,
    pageViewBlocks: Math.ceil(pageViews / 1000),
    aiTokens,
    aiProviderEstimateEur,
  };
}

export function formatEur(amount: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function buildWebsiteCostBreakdown(input: {
  websiteId: string;
  seatCount: number;
}) {
  const seats = Math.max(1, input.seatCount);
  const usage = estimateWebsiteUsage(input.websiteId);

  const website = WEBSITE_COST_RATES.websitePerMonthEur;
  const seatsTotal = seats * WEBSITE_COST_RATES.seatPerMonthEur;
  const pageViewsTotal =
    usage.pageViewBlocks * WEBSITE_COST_RATES.perThousandPageViewsEur;
  const ai = usage.aiProviderEstimateEur;
  const auroraSubtotal = website + seatsTotal + pageViewsTotal;
  const total = auroraSubtotal + ai;

  return {
    seats,
    usage,
    lines: [
      {
        id: "website",
        label: "Website",
        detail: `1 × ${formatEur(WEBSITE_COST_RATES.websitePerMonthEur)} / month`,
        amount: website,
        note: "Active website tenant",
      },
      {
        id: "seats",
        label: "Seats / licenses",
        detail: `${seats} × ${formatEur(WEBSITE_COST_RATES.seatPerMonthEur)} / month`,
        amount: seatsTotal,
        note: "Memberships on this website",
      },
      {
        id: "pageViews",
        label: "Page views",
        detail: `${usage.pageViewBlocks.toLocaleString("nl-NL")} × ${formatEur(WEBSITE_COST_RATES.perThousandPageViewsEur)} per 1.000`,
        amount: pageViewsTotal,
        note: `${usage.pageViews.toLocaleString("nl-NL")} views this month`,
      },
      {
        id: "ai",
        label: "AI tokens (provider)",
        detail: `${usage.aiTokens.toLocaleString("nl-NL")} tokens · passthrough`,
        amount: ai,
        note: "Billed by your model provider, not Aurora",
      },
    ],
    auroraSubtotal,
    total,
  };
}
