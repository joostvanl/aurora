import { z } from "zod";

export const MediaProviderSchema = z.enum(["local", "imagekit"]);
export type MediaProvider = z.infer<typeof MediaProviderSchema>;

export const MediaStatusSchema = z.object({
  provider: MediaProviderSchema,
  configured: z.boolean(),
  /** True when ImageKit credentials are complete enough to upload. */
  imagekitConfigured: z.boolean(),
  publicKey: z.string().nullable(),
  publicKeyConfigured: z.boolean(),
  publicKeyPreview: z.string().nullable(),
  privateKeyConfigured: z.boolean(),
  privateKeyPreview: z.string().nullable(),
  urlEndpoint: z.string().nullable(),
  /** Optional ImageKit folder prefix (e.g. /aurora/my-site). */
  folder: z.string().nullable(),
  source: z.enum(["settings", "none"]),
});

export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const MediaConfigUpdateSchema = z.object({
  provider: MediaProviderSchema.optional(),
  publicKey: z.string().optional(),
  privateKey: z.string().optional(),
  clearPrivateKey: z.boolean().optional(),
  clearPublicKey: z.boolean().optional(),
  urlEndpoint: z.union([z.string().url(), z.literal("")]).optional(),
  /** Empty or null clears folder (ImageKit uses default). */
  folder: z.union([z.string().max(200), z.null()]).optional(),
});

export type MediaConfigUpdate = z.input<typeof MediaConfigUpdateSchema>;

export const MediaUploadResultSchema = z.object({
  url: z.string().url(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  provider: MediaProviderSchema,
  /** ImageKit file id when provider is imagekit. */
  fileId: z.string().optional(),
});

export type MediaUploadResult = z.infer<typeof MediaUploadResultSchema>;

export const MediaLibraryItemSchema = z.object({
  fileId: z.string(),
  name: z.string(),
  url: z.string().url(),
  thumbnailUrl: z.string().url(),
  filePath: z.string(),
  mimeType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  size: z.number().int().nonnegative(),
  createdAt: z.string().nullable(),
});

export type MediaLibraryItem = z.infer<typeof MediaLibraryItemSchema>;

export const MediaLibraryResponseSchema = z.object({
  provider: z.literal("imagekit"),
  items: z.array(MediaLibraryItemSchema),
  skip: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type MediaLibraryResponse = z.infer<typeof MediaLibraryResponseSchema>;
