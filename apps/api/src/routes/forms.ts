import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CreateFormFieldSchema,
  CreateFormSchema,
  ListFormSubmissionsQuerySchema,
  SubmitFormSchema,
  UpdateFormFieldSchema,
  UpdateFormSchema,
  UpdateFormSubmissionSchema,
  type FormFieldOption,
} from "@cms/shared";
import type { FormFieldType, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import {
  requireSiteKey,
  requireWebsite,
  websiteIdFrom,
  siteWebsiteIdFrom,
} from "../auth/middleware.js";
import { roleAtLeast } from "../auth/roles.js";
import { serializeForm, serializeFormSubmission, getFormOrThrow, formInclude } from "../lib/forms.js";

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function assertBuilder(request: { user?: { role?: string | null } }) {
  if (
    !roleAtLeast(
      request.user?.role as "editor" | "builder" | "admin" | null,
      "builder",
    )
  ) {
    throw httpError(403, "Requires builder or admin role");
  }
}

function parseOptions(value: unknown): FormFieldOption[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  return value as FormFieldOption[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s().-]{7,}$/;

function validateSubmissionFields(
  fields: Array<{
    apiId: string;
    type: FormFieldType;
    required: boolean;
    options: unknown;
  }>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Set(fields.map((f) => f.apiId));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw httpError(400, `Unknown field "${key}"`);
    }
  }

  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = input[field.apiId];

    if (field.type === "honeypot") {
      if (raw != null && String(raw).trim() !== "") {
        throw httpError(400, "Submission rejected");
      }
      continue;
    }

    if (field.type === "checkbox") {
      const checked = raw === true || raw === "true" || raw === "on" || raw === 1;
      if (field.required && !checked) {
        throw httpError(400, `Field "${field.apiId}" is required`);
      }
      payload[field.apiId] = checked;
      continue;
    }

    const empty =
      raw == null ||
      (typeof raw === "string" && raw.trim() === "") ||
      (typeof raw === "number" && Number.isNaN(raw));

    if (empty) {
      if (field.required) {
        throw httpError(400, `Field "${field.apiId}" is required`);
      }
      continue;
    }

    switch (field.type) {
      case "email": {
        const value = String(raw).trim();
        if (!EMAIL_RE.test(value)) {
          throw httpError(400, `Field "${field.apiId}" must be a valid email`);
        }
        payload[field.apiId] = value;
        break;
      }
      case "phone": {
        const value = String(raw).trim();
        if (!PHONE_RE.test(value)) {
          throw httpError(400, `Field "${field.apiId}" must be a valid phone`);
        }
        payload[field.apiId] = value;
        break;
      }
      case "number": {
        const value = typeof raw === "number" ? raw : Number(raw);
        if (Number.isNaN(value)) {
          throw httpError(400, `Field "${field.apiId}" must be a number`);
        }
        payload[field.apiId] = value;
        break;
      }
      case "select":
      case "radio": {
        const value = String(raw);
        const options = parseOptions(field.options) ?? [];
        if (options.length > 0 && !options.some((o) => o.value === value)) {
          throw httpError(400, `Field "${field.apiId}" has an invalid option`);
        }
        payload[field.apiId] = value;
        break;
      }
      default:
        payload[field.apiId] = String(raw);
    }
  }

  return payload;
}

/** In-memory sliding window: max 10 submits / minute per siteKey+IP */
const submitBuckets = new Map<string, number[]>();

function assertRateLimit(key: string) {
  const now = Date.now();
  const windowMs = 60_000;
  const max = 10;
  const timestamps = (submitBuckets.get(key) ?? []).filter(
    (t) => now - t < windowMs,
  );
  if (timestamps.length >= max) {
    throw httpError(429, "Too many submissions. Try again shortly.");
  }
  timestamps.push(now);
  submitBuckets.set(key, timestamps);
}

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.ip || "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function registerFormRoutes(app: FastifyInstance) {
  // --- Public ---
  app.register(async (publicApi) => {
    publicApi.addHook("preHandler", requireSiteKey);

    publicApi.get<{ Params: { apiId: string } }>(
      "/api/v1/forms/:apiId",
      async (request) => {
        const form = await getFormOrThrow(
          request.params.apiId,
          siteWebsiteIdFrom(request),
        );
        if (!form.enabled) {
          throw httpError(404, `Form "${request.params.apiId}" not found`);
        }
        return serializeForm(form);
      },
    );

    publicApi.post<{ Params: { apiId: string } }>(
      "/api/v1/forms/:apiId/submit",
      async (request) => {
        const websiteId = siteWebsiteIdFrom(request);
        const form = await getFormOrThrow(request.params.apiId, websiteId);
        if (!form.enabled) {
          throw httpError(404, `Form "${request.params.apiId}" not found`);
        }

        const ip = clientIp(request);
        assertRateLimit(`${websiteId}:${ip}`);

        const body = SubmitFormSchema.parse(request.body);
        const payload = validateSubmissionFields(form.fields, body.fields);

        await prisma.formSubmission.create({
          data: {
            formId: form.id,
            payload: payload as Prisma.InputJsonValue,
            meta: {
              userAgent:
                typeof request.headers["user-agent"] === "string"
                  ? request.headers["user-agent"].slice(0, 300)
                  : null,
              ipHash: hashIp(ip),
              referer:
                typeof request.headers.referer === "string"
                  ? request.headers.referer.slice(0, 500)
                  : null,
            } as Prisma.InputJsonValue,
          },
        });

        return { ok: true as const, message: form.successMessage };
      },
    );
  });

  // --- Admin ---
  app.register(async (admin) => {
    admin.addHook("preHandler", requireWebsite());

    admin.get("/api/v1/admin/forms", async (request) => {
      const items = await prisma.form.findMany({
        where: { websiteId: websiteIdFrom(request) },
        include: formInclude,
        orderBy: { name: "asc" },
      });
      return items.map(serializeForm);
    });

    admin.post("/api/v1/admin/forms", async (request) => {
      assertBuilder(request);
      const body = CreateFormSchema.parse(request.body);
      const websiteId = websiteIdFrom(request);
      const existing = await prisma.form.findUnique({
        where: { websiteId_apiId: { websiteId, apiId: body.apiId } },
      });
      if (existing) {
        throw httpError(409, `Form "${body.apiId}" already exists`);
      }

      const form = await prisma.form.create({
        data: {
          websiteId,
          apiId: body.apiId,
          name: body.name,
          description: body.description,
          submitLabel: body.submitLabel ?? "Submit",
          successMessage:
            body.successMessage ?? "Thanks — we received your message.",
          enabled: body.enabled ?? true,
        },
        include: formInclude,
      });
      return serializeForm(form);
    });

    admin.get<{ Params: { apiId: string } }>(
      "/api/v1/admin/forms/:apiId",
      async (request) => {
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        return serializeForm(form);
      },
    );

    admin.patch<{ Params: { apiId: string } }>(
      "/api/v1/admin/forms/:apiId",
      async (request) => {
        assertBuilder(request);
        const body = UpdateFormSchema.parse(request.body);
        const existing = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const form = await prisma.form.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined
              ? { description: body.description }
              : {}),
            ...(body.submitLabel !== undefined
              ? { submitLabel: body.submitLabel }
              : {}),
            ...(body.successMessage !== undefined
              ? { successMessage: body.successMessage }
              : {}),
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          },
          include: formInclude,
        });
        return serializeForm(form);
      },
    );

    admin.delete<{ Params: { apiId: string } }>(
      "/api/v1/admin/forms/:apiId",
      async (request) => {
        assertBuilder(request);
        const existing = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        await prisma.form.delete({ where: { id: existing.id } });
        return { ok: true as const };
      },
    );

    admin.post<{ Params: { apiId: string } }>(
      "/api/v1/admin/forms/:apiId/fields",
      async (request) => {
        assertBuilder(request);
        const body = CreateFormFieldSchema.parse(request.body);
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const maxSort = form.fields.reduce(
          (max, f) => Math.max(max, f.sortOrder),
          -1,
        );
        try {
          await prisma.formField.create({
            data: {
              formId: form.id,
              apiId: body.apiId,
              label: body.label,
              type: body.type,
              required: body.required ?? false,
              placeholder: body.placeholder ?? null,
              helpText: body.helpText ?? null,
              options: (body.options ?? null) as Prisma.InputJsonValue,
              sortOrder: body.sortOrder ?? maxSort + 1,
            },
          });
        } catch {
          throw httpError(409, `Field "${body.apiId}" already exists`);
        }
        return serializeForm(await getFormOrThrow(form.apiId, form.websiteId));
      },
    );

    admin.patch<{ Params: { apiId: string; fieldApiId: string } }>(
      "/api/v1/admin/forms/:apiId/fields/:fieldApiId",
      async (request) => {
        assertBuilder(request);
        const body = UpdateFormFieldSchema.parse(request.body);
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const field = form.fields.find(
          (f) => f.apiId === request.params.fieldApiId,
        );
        if (!field) {
          throw httpError(
            404,
            `Field "${request.params.fieldApiId}" not found`,
          );
        }
        await prisma.formField.update({
          where: { id: field.id },
          data: {
            ...(body.label !== undefined ? { label: body.label } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.required !== undefined ? { required: body.required } : {}),
            ...(body.placeholder !== undefined
              ? { placeholder: body.placeholder }
              : {}),
            ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
            ...(body.options !== undefined
              ? { options: body.options as Prisma.InputJsonValue }
              : {}),
            ...(body.sortOrder !== undefined
              ? { sortOrder: body.sortOrder }
              : {}),
          },
        });
        return serializeForm(await getFormOrThrow(form.apiId, form.websiteId));
      },
    );

    admin.delete<{ Params: { apiId: string; fieldApiId: string } }>(
      "/api/v1/admin/forms/:apiId/fields/:fieldApiId",
      async (request) => {
        assertBuilder(request);
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const field = form.fields.find(
          (f) => f.apiId === request.params.fieldApiId,
        );
        if (!field) {
          throw httpError(
            404,
            `Field "${request.params.fieldApiId}" not found`,
          );
        }
        await prisma.formField.delete({ where: { id: field.id } });
        return serializeForm(await getFormOrThrow(form.apiId, form.websiteId));
      },
    );

    admin.get<{
      Params: { apiId: string };
      Querystring: Record<string, string>;
    }>("/api/v1/admin/forms/:apiId/submissions", async (request) => {
      const form = await getFormOrThrow(
        request.params.apiId,
        websiteIdFrom(request),
      );
      const query = ListFormSubmissionsQuerySchema.parse(request.query);
      const where = { formId: form.id };
      const [items, total] = await Promise.all([
        prisma.formSubmission.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: query.limit,
          skip: query.offset,
        }),
        prisma.formSubmission.count({ where }),
      ]);
      return {
        items: items.map((s) => serializeFormSubmission(s, form.apiId)),
        total,
        limit: query.limit,
        offset: query.offset,
      };
    });

    admin.get<{ Params: { apiId: string; id: string } }>(
      "/api/v1/admin/forms/:apiId/submissions/:id",
      async (request) => {
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const submission = await prisma.formSubmission.findFirst({
          where: { id: request.params.id, formId: form.id },
        });
        if (!submission) throw httpError(404, "Submission not found");
        return serializeFormSubmission(submission, form.apiId);
      },
    );

    admin.patch<{ Params: { apiId: string; id: string } }>(
      "/api/v1/admin/forms/:apiId/submissions/:id",
      async (request) => {
        const body = UpdateFormSubmissionSchema.parse(request.body);
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const submission = await prisma.formSubmission.findFirst({
          where: { id: request.params.id, formId: form.id },
        });
        if (!submission) throw httpError(404, "Submission not found");

        const updated = await prisma.formSubmission.update({
          where: { id: submission.id },
          data: {
            readAt:
              body.read === true
                ? (submission.readAt ?? new Date())
                : body.read === false
                  ? null
                  : undefined,
          },
        });
        return serializeFormSubmission(updated, form.apiId);
      },
    );

    admin.delete<{ Params: { apiId: string; id: string } }>(
      "/api/v1/admin/forms/:apiId/submissions/:id",
      async (request) => {
        const form = await getFormOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        const submission = await prisma.formSubmission.findFirst({
          where: { id: request.params.id, formId: form.id },
        });
        if (!submission) throw httpError(404, "Submission not found");
        await prisma.formSubmission.delete({ where: { id: submission.id } });
        return { ok: true as const };
      },
    );
  });
}
