import { z } from "zod";
import { FlatEntrySchema } from "./schemas.js";

export const AiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;

export const AiChatContextSchema = z.object({
  contentTypeApiId: z.string().optional(),
  entryId: z.string().optional(),
  formApiId: z.string().optional(),
  mode: z.enum(["general", "write", "optimize"]).optional(),
  /** Current admin studio path (e.g. /entries/page/xyz). */
  pathname: z.string().optional(),
  /** Short human label for the screen (e.g. "Entry editor"). */
  page: z.string().optional(),
  websiteName: z.string().optional(),
});

export type AiChatContext = z.infer<typeof AiChatContextSchema>;

export const AiChatRequestSchema = z.object({
  message: z.string().min(1),
  history: z.array(AiChatMessageSchema).max(40).optional(),
  /** Screen focus for the agent (studio dock / entry shortcuts). */
  context: AiChatContextSchema.optional(),
});

export type AiChatRequest = z.input<typeof AiChatRequestSchema>;

export const AiToolCallResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
});

export type AiToolCallResult = z.infer<typeof AiToolCallResultSchema>;

export const AiChatResponseSchema = z.object({
  reply: z.string(),
  toolCalls: z.array(AiToolCallResultSchema),
  model: z.string(),
  /** Latest entry after tools when context.entryId was set. */
  entry: FlatEntrySchema.optional(),
  versionCreated: z
    .object({
      id: z.string(),
      label: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable()
    .optional(),
});

export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

export const EntrySnapshotSchema = z.object({
  slug: z.string(),
  status: z.string(),
  locale: z.string(),
  fields: z.record(z.unknown()),
});

export type EntrySnapshot = z.infer<typeof EntrySnapshotSchema>;

export const EntryVersionSchema = z.object({
  id: z.string(),
  entryId: z.string(),
  label: z.string().nullable(),
  source: z.string(),
  snapshot: EntrySnapshotSchema,
  createdAt: z.string(),
});

export type EntryVersion = z.infer<typeof EntryVersionSchema>;

export const AiStatusSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  apiKeyConfigured: z.boolean(),
  apiKeyPreview: z.string().nullable(),
  source: z.enum(["settings", "none"]),
  /** EUR estimated cost per token for this website. */
  costPerTokenEur: z.number().nonnegative(),
  /** Website-specific AI behavior instructions (empty when unset). */
  instructions: z.string().default(""),
  usage: z
    .object({
      periodFrom: z.string(),
      periodTo: z.string(),
      callCount: z.number().int().nonnegative(),
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      estimatedCostEur: z.number().nonnegative(),
    })
    .optional(),
});

export type AiStatus = z.infer<typeof AiStatusSchema>;

export const AiConfigUpdateSchema = z.object({
  baseUrl: z.union([z.string().url(), z.literal("")]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  /** Clear stored API key and fall back to env */
  clearApiKey: z.boolean().optional(),
  /** EUR per token; null clears to default */
  costPerTokenEur: z.union([z.number().nonnegative(), z.null()]).optional(),
  /** Website-specific AI instructions; empty/null clears */
  instructions: z.union([z.string().max(8000), z.null()]).optional(),
});

export type AiConfigUpdate = z.input<typeof AiConfigUpdateSchema>;
