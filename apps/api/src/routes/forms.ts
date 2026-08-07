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
import { httpError, type ApiIssue } from "../lib/httpError.js";
import { assertRateLimit, clientIpFromHeaders } from "../lib/rateLimit.js";

function assertBuilder(request: { user?: { role?: string | null } }) {
  if (
    !roleAtLeast(
      request.user?.role as "editor" | "builder" | "admin" | null,
      "builder",
    )
  ) {
    throw httpError(403, "Requires builder or admin role", "FORBIDDEN");
  }
}

function parseOptions(value: unknown): FormFieldOption[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  return value as FormFieldOption[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s().-]{7,}$/;

function validationError(message: string, issues: ApiIssue[]) {
  return httpError(400, message, "VALIDATION_FAILED", issues);
}

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
      throw validationError(`Unknown field "${key}"`, [
        { path: [key], code: "unknown", message: `Unknown field "${key}"` },
      ]);
    }
  }

  const payload: Record<string, unknown> = {};
  const issues: ApiIssue[] = [];

  for (const field of fields) {
    const raw = input[field.apiId];

    if (field.type === "honeypot") {
      if (raw != null && String(raw).trim() !== "") {
        throw httpError(400, "Submission rejected", "VALIDATION_FAILED");
      }
      continue;
    }

    if (field.type === "checkbox") {
      const checked = raw === true || raw === "true" || raw === "on" || raw === 1;
      if (field.required && !checked) {
        issues.push({
          path: [field.apiId],
          code: "required",
          message: `Field "${field.apiId}" is required`,
        });
      } else {
        payload[field.apiId] = checked;
      }
      continue;
    }

    const empty =
      raw == null ||
      (typeof raw === "string" && raw.trim() === "") ||
      (typeof raw === "number" && Number.isNaN(raw));

    if (empty) {
      if (field.required) {
        issues.push({
          path: [field.apiId],
          code: "required",
          message: `Field "${field.apiId}" is required`,
        });
      }
      continue;
    }

    switch (field.type) {
      case "email": {
        const value = String(raw).trim();
        if (!EMAIL_RE.test(value)) {
          issues.push({
            path: [field.apiId],
            code: "invalid_email",
            message: `Field "${field.apiId}" must be a valid email`,
          });
        } else {
          payload[field.apiId] = value;
        }
        break;
      }
      case "phone": {
        const value = String(raw).trim();
        if (!PHONE_RE.test(value)) {
          issues.push({
            path: [field.apiId],
            code: "invalid_phone",
            message: `Field "${field.apiId}" must be a valid phone`,
          });
        } else {
          payload[field.apiId] = value;
        }
        break;
      }
      case "number": {
        const value = typeof raw === "number" ? raw : Number(raw);
        if (Number.isNaN(value)) {
          issues.push({
            path: [field.apiId],
            code: "invalid_number",
            message: `Field "${field.apiId}" must be a number`,
          });
        } else {
          payload[field.apiId] = value;
        }
        break;
      }
      case "select":
      case "radio": {
        const value = String(raw);
        const options = parseOptions(field.options) ?? [];
        if (options.length > 0 && !options.some((o) => o.value === value)) {
          issues.push({
            path: [field.apiId],
            code: "invalid_option",
            message: `Field "${field.apiId}" has an invalid option`,
          });
        } else {
          payload[field.apiId] = value;
        }
        break;
      }
      default:
        payload[field.apiId] = String(raw);
    }
  }

  if (issues.length > 0) {
    throw validationError(issues[0]!.message, issues);
  }

  return payload;
}

/** In-memory sliding window: max 10 submits / minute per siteKey+IP */
function assertSubmitRateLimit(key: string) {
  assertRateLimit(key, {
    windowMs: 60_000,
    max: 10,
    message: "Too many submissions. Try again shortly.",
  });
}

function clientIp(request: FastifyRequest): string {
  return clientIpFromHeaders({
    headers: request.headers as Record<string, unknown>,
    ip: request.ip,
  });
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
        assertSubmitRateLimit(`${websiteId}:${ip}`);

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
