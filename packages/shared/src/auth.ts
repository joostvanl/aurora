import { z } from "zod";

export const WebsiteRoleSchema = z.enum(["editor", "builder", "admin"]);
export type WebsiteRole = z.infer<typeof WebsiteRoleSchema>;

export const WebsiteMembershipSchema = z.object({
  id: z.string(),
  name: z.string(),
  siteKey: z.string(),
  role: WebsiteRoleSchema,
});

export type WebsiteMembership = z.infer<typeof WebsiteMembershipSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  /** Active website context (null until selected when multi-site). */
  websiteId: z.string().nullable().optional(),
  websiteName: z.string().nullable().optional(),
  role: WebsiteRoleSchema.nullable().optional(),
  siteKey: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
  websites: z.array(WebsiteMembershipSchema),
  needsWebsiteSelection: z.boolean(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RegisterInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  websiteName: z.string().min(1).optional(),
});

export type RegisterInput = z.input<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.input<typeof LoginInputSchema>;

export const SelectWebsiteInputSchema = z.object({
  websiteId: z.string().min(1),
});

export type SelectWebsiteInput = z.infer<typeof SelectWebsiteInputSchema>;

export const CreateWebsiteInputSchema = z.object({
  name: z.string().min(1),
});

export type CreateWebsiteInput = z.infer<typeof CreateWebsiteInputSchema>;

export const UpdateWebsiteInputSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.union([z.string().max(2000), z.literal("")]).optional(),
    /** Browser origins allowed for CORS for this website (e.g. frontend URL). */
    allowedOrigins: z.array(z.string().max(500)).max(50).optional(),
    /** BCP-47 language-REGION tags enabled for this website. */
    locales: z
      .array(
        z
          .string()
          .regex(
            /^[a-z]{2}-[A-Z]{2}$/,
            "locale must be language-REGION (e.g. en-US)",
          ),
      )
      .min(1)
      .max(50)
      .optional(),
    defaultLocale: z
      .string()
      .regex(
        /^[a-z]{2}-[A-Z]{2}$/,
        "locale must be language-REGION (e.g. en-US)",
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.locales) {
      const unique = new Set(data.locales);
      if (unique.size !== data.locales.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "locales must be unique",
          path: ["locales"],
        });
      }
    }
    if (
      data.defaultLocale &&
      data.locales &&
      !data.locales.includes(data.defaultLocale)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultLocale must be included in locales",
        path: ["defaultLocale"],
      });
    }
  });

export type UpdateWebsiteInput = z.input<typeof UpdateWebsiteInputSchema>;

export const WebsiteDetailsSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  siteKey: z.string(),
  allowedOrigins: z.array(z.string()),
  locales: z.array(z.string()),
  defaultLocale: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WebsiteDetails = z.infer<typeof WebsiteDetailsSchema>;

export const AddMemberInputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: WebsiteRoleSchema,
  /** Required when creating a brand-new user account. */
  password: z.string().min(8).optional(),
});

export type AddMemberInput = z.input<typeof AddMemberInputSchema>;

export const UpdateMemberInputSchema = z.object({
  role: WebsiteRoleSchema,
});

export type UpdateMemberInput = z.infer<typeof UpdateMemberInputSchema>;
