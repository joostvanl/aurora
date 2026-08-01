/** Demo rate card for Aurora variable pricing (EUR / month). */
export const WEBSITE_COST_RATES = {
  websitePerMonthEur: 49,
  seatPerMonthEur: 15,
  perThousandPageViewsEur: 0.5,
} as const;

export function formatEur(amount: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function buildWebsiteCostBreakdown(input: {
  seatCount: number;
  /** Metered public content API requests this month. */
  pageViews?: number;
  aiTokens?: number;
  aiCostPerTokenEur?: number;
  aiEstimatedCostEur?: number;
}) {
  const seats = Math.max(1, input.seatCount);
  const pageViews = Math.max(0, Math.floor(input.pageViews ?? 0));
  const pageViewBlocks = pageViews === 0 ? 0 : Math.ceil(pageViews / 1000);
  const aiTokens = Math.max(0, input.aiTokens ?? 0);
  const costPerToken = Math.max(0, input.aiCostPerTokenEur ?? 0);
  const ai =
    input.aiEstimatedCostEur != null
      ? input.aiEstimatedCostEur
      : Math.round(aiTokens * costPerToken * 1_000_000) / 1_000_000;

  const website = WEBSITE_COST_RATES.websitePerMonthEur;
  const seatsTotal = seats * WEBSITE_COST_RATES.seatPerMonthEur;
  const pageViewsTotal =
    pageViewBlocks * WEBSITE_COST_RATES.perThousandPageViewsEur;
  const auroraSubtotal = website + seatsTotal + pageViewsTotal;
  const total = auroraSubtotal + ai;

  return {
    seats,
    usage: {
      pageViews,
      pageViewBlocks,
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
        detail: `${pageViewBlocks.toLocaleString("nl-NL")} × ${formatEur(WEBSITE_COST_RATES.perThousandPageViewsEur)} per 1.000`,
        amount: pageViewsTotal,
        note:
          pageViews === 0
            ? "No public content requests recorded this month yet"
            : `${pageViews.toLocaleString("nl-NL")} content requests this month`,
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
