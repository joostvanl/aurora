import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

const formFieldType = z.enum([
  "text",
  "email",
  "phone",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
  "honeypot",
]);

const optionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

export function registerFormTools(server: McpServer, ctx: McpContext) {
  const { client } = ctx;

  server.tool(
    "list_forms",
    "List forms for the authenticated website.",
    {},
    async () => {
      try {
        return toolOk(await client.listForms());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_form",
    "Get a form schema by apiId (management).",
    { apiId: z.string().min(1) },
    async ({ apiId }) => {
      try {
        return toolOk(await client.getForm(apiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "create_form",
    "Create a form.",
    {
      apiId: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
      name: z.string().min(1),
      description: z.string().optional(),
      submitLabel: z.string().optional(),
      successMessage: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async (input) => {
      try {
        return toolOk(await client.createForm(input));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "update_form",
    "Update form metadata.",
    {
      apiId: z.string().min(1),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      submitLabel: z.string().optional(),
      successMessage: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async ({ apiId, ...body }) => {
      try {
        return toolOk(await client.updateForm(apiId, body));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "delete_form",
    "Delete a form and its submissions.",
    { apiId: z.string().min(1) },
    async ({ apiId }) => {
      try {
        return toolOk(await client.deleteForm(apiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "create_form_field",
    "Add a field to a form. Options for select/radio: [{ value, label }].",
    {
      formApiId: z.string().min(1),
      apiId: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().min(1),
      type: formFieldType,
      required: z.boolean().optional(),
      placeholder: z.string().nullable().optional(),
      helpText: z.string().nullable().optional(),
      options: z.array(optionSchema).nullable().optional(),
      sortOrder: z.number().int().optional(),
    },
    async ({ formApiId, ...input }) => {
      try {
        return toolOk(await client.createFormField(formApiId, input));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "update_form_field",
    "Update a form field.",
    {
      formApiId: z.string().min(1),
      fieldApiId: z.string().min(1),
      label: z.string().min(1).optional(),
      type: formFieldType.optional(),
      required: z.boolean().optional(),
      placeholder: z.string().nullable().optional(),
      helpText: z.string().nullable().optional(),
      options: z.array(optionSchema).nullable().optional(),
      sortOrder: z.number().int().optional(),
    },
    async ({ formApiId, fieldApiId, ...body }) => {
      try {
        return toolOk(
          await client.updateFormField(formApiId, fieldApiId, body),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "delete_form_field",
    "Delete a form field.",
    {
      formApiId: z.string().min(1),
      fieldApiId: z.string().min(1),
    },
    async ({ formApiId, fieldApiId }) => {
      try {
        return toolOk(await client.deleteFormField(formApiId, fieldApiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "list_form_submissions",
    "List form submissions (inbox).",
    {
      formApiId: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ formApiId, ...params }) => {
      try {
        return toolOk(await client.listFormSubmissions(formApiId, params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_form_submission",
    "Get one form submission.",
    {
      formApiId: z.string().min(1),
      submissionId: z.string().min(1),
    },
    async ({ formApiId, submissionId }) => {
      try {
        return toolOk(await client.getFormSubmission(formApiId, submissionId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "mark_form_submission_read",
    "Mark a submission read or unread.",
    {
      formApiId: z.string().min(1),
      submissionId: z.string().min(1),
      read: z.boolean(),
    },
    async ({ formApiId, submissionId, read }) => {
      try {
        return toolOk(
          await client.updateFormSubmission(formApiId, submissionId, { read }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "delete_form_submission",
    "Delete a form submission.",
    {
      formApiId: z.string().min(1),
      submissionId: z.string().min(1),
    },
    async ({ formApiId, submissionId }) => {
      try {
        return toolOk(
          await client.deleteFormSubmission(formApiId, submissionId),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
