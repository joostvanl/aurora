import { z } from "zod";

export const ContentRequestUsageSchema = z.object({
  periodFrom: z.string(),
  periodTo: z.string(),
  requestCount: z.number().int().nonnegative(),
  listCount: z.number().int().nonnegative(),
  getCount: z.number().int().nonnegative(),
  pageViews: z.number().int().nonnegative(),
});

export type ContentRequestUsage = z.infer<typeof ContentRequestUsageSchema>;
