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

/** Stable illustrative page-view usage until real metering exists. */
export function estimateWebsiteUsage(websiteId: string) {
  const seed = hashSeed(websiteId || "default");
  const pageViews = 18_000 + (seed % 90_000);

  return {
    pageViews,
    pageViewBlocks: Math.ceil(pageViews / 1000),
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
  aiTokens?: number;
  aiCostPerTokenEur?: number;
  aiEstimatedCostEur?: number;
}) {
  const seats = Math.max(1, input.seatCount);
  const usage = estimateWebsiteUsage(input.websiteId);
  const aiTokens = Math.max(0, input.aiTokens ?? 0);
  const costPerToken = Math.max(0, input.aiCostPerTokenEur ?? 0);
  const ai =
    input.aiEstimatedCostEur != null
      ? input.aiEstimatedCostEur
      : Math.round(aiTokens * costPerToken * 1_000_000) / 1_000_000;

  const website = WEBSITE_COST_RATES.websitePerMonthEur;
  const seatsTotal = seats * WEBSITE_COST_RATES.seatPerMonthEur;
  const pageViewsTotal =
    usage.pageViewBlocks * WEBSITE_COST_RATES.perThousandPageViewsEur;
  const auroraSubtotal = website + seatsTotal + pageViewsTotal;
  const total = auroraSubtotal + ai;

  return {
    seats,
    usage: {
      ...usage,
      aiTokens,
      aiCostPerTokenEur: costPerToken,
      aiProviderEstimateEur: ai,
    },
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
        label: "AI tokens",
        detail: `${aiTokens.toLocaleString("nl-NL")} tokens × ${costPerToken.toLocaleString("en-US", { maximumFractionDigits: 12 })} EUR`,
        amount: ai,
        note:
          aiTokens === 0
            ? "No AI usage recorded this month yet"
            : "Actual usage this month × configured cost per token",
      },
    ],
    auroraSubtotal,
    total,
  };
}
