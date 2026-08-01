import { prisma } from "../db.js";
import { monthRangeUtc } from "../ai/usage.js";

export type ContentRequestKind = "list" | "get";

export async function recordContentRequest(input: {
  websiteId: string;
  contentTypeApiId: string;
  entrySlug?: string | null;
  kind: ContentRequestKind;
}) {
  await prisma.contentRequestEvent.create({
    data: {
      websiteId: input.websiteId,
      contentTypeApiId: input.contentTypeApiId,
      entrySlug: input.entrySlug ?? null,
      kind: input.kind,
    },
  });
}

/** Fire-and-forget metering — must never break the content response. */
export function trackContentRequest(input: {
  websiteId: string;
  contentTypeApiId: string;
  entrySlug?: string | null;
  kind: ContentRequestKind;
}) {
  void recordContentRequest(input).catch(() => {
    // Metering must not break public reads.
  });
}

export async function sumContentRequestsForWebsite(
  websiteId: string,
  range?: { from: Date; to: Date },
) {
  const { from, to } = range ?? monthRangeUtc();
  const aggregates = await prisma.contentRequestEvent.groupBy({
    by: ["kind"],
    where: {
      websiteId,
      createdAt: { gte: from, lt: to },
    },
    _count: true,
  });

  let listCount = 0;
  let getCount = 0;
  for (const row of aggregates) {
    if (row.kind === "list") listCount = row._count;
    else if (row.kind === "get") getCount = row._count;
  }

  const requestCount = listCount + getCount;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    requestCount,
    listCount,
    getCount,
    /** Billable page views = successful public content deliveries this month. */
    pageViews: requestCount,
  };
}
