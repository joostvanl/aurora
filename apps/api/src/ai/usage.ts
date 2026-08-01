import { prisma } from "../db.js";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AiUsageMeter = {
  websiteId: string;
  userId?: string | null;
  source: string;
};

export async function recordAiUsage(input: {
  websiteId: string;
  userId?: string | null;
  source: string;
  model?: string | null;
  usage: TokenUsage;
}) {
  const promptTokens = Math.max(0, Math.floor(input.usage.promptTokens));
  const completionTokens = Math.max(0, Math.floor(input.usage.completionTokens));
  const totalTokens = Math.max(
    0,
    Math.floor(
      input.usage.totalTokens || promptTokens + completionTokens,
    ),
  );
  if (totalTokens === 0 && promptTokens === 0 && completionTokens === 0) {
    return;
  }

  await prisma.aiUsageEvent.create({
    data: {
      websiteId: input.websiteId,
      userId: input.userId ?? null,
      source: input.source,
      model: input.model ?? null,
      promptTokens,
      completionTokens,
      totalTokens,
    },
  });
}

export function monthRangeUtc(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

export async function sumAiUsageForWebsite(
  websiteId: string,
  range?: { from: Date; to: Date },
) {
  const { from, to } = range ?? monthRangeUtc();
  const aggregates = await prisma.aiUsageEvent.aggregate({
    where: {
      websiteId,
      createdAt: { gte: from, lt: to },
    },
    _sum: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
    },
    _count: true,
  });

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    callCount: aggregates._count,
    promptTokens: aggregates._sum.promptTokens ?? 0,
    completionTokens: aggregates._sum.completionTokens ?? 0,
    totalTokens: aggregates._sum.totalTokens ?? 0,
  };
}
