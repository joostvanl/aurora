import type {
  ContentType,
  CreateContentTypeInput,
  CreateEntryInput,
  CreateFieldDefinitionInput,
  CreateFormFieldInput,
  CreateFormInput,
  CreateTranslationInput,
  FlatEntry,
  Form,
  FormSubmission,
  PublicLocalesResponse,
  SubmitFormInput,
  SubmitFormResult,
  UpdateContentTypeInput,
  UpdateEntryInput,
  UpdateFieldDefinitionInput,
  UpdateFormFieldInput,
  UpdateFormInput,
  UpdateFormSubmissionInput,
} from "./schemas.js";
import type {
  AiChatRequest,
  AiChatResponse,
  AiConfigUpdate,
  AiStatus,
  EntryVersion,
} from "./ai.js";
import type { ContentRequestUsage } from "./analytics.js";
import type {
  AuthResponse,
  AuthUser,
  LoginInput,
  RegisterInput,
  SelectWebsiteInput,
  CreateWebsiteInput,
  UpdateWebsiteInput,
  AddMemberInput,
  UpdateMemberInput,
  WebsiteDetails,
  WebsiteMembership,
} from "./auth.js";

export type CmsClientOptions = {
  baseUrl: string;
  /** JWT access token for admin routes */
  token?: string | null;
  /** Public site key for read API */
  siteKey?: string | null;
  fetch?: typeof fetch;
};

export type ListEntriesParams = {
  limit?: number;
  offset?: number;
  slug?: string;
  status?: "draft" | "published";
  locale?: string;
  sort?: "publishedAt" | "createdAt" | "updatedAt" | "sortOrder";
  order?: "asc" | "desc";
};

export type ListEntriesResult = {
  items: FlatEntry[];
  total: number;
  limit: number;
  offset: number;
  sort?: string;
  order?: string;
};

export type BootstrapPayload = {
  siteSettings: FlatEntry | null;
  nav: FlatEntry[];
  primaryPage: FlatEntry | null;
  locale?: string;
};

export type CorsCheckResult = {
  allowed: boolean;
  origin: string | null;
  hint: string;
};

export type PreviewTokenResult = {
  token: string;
  expiresAt: string;
  previewUrl: string;
  apiUrl: string;
};

export type PackageApplyCounters = {
  created: number;
  updated: number;
  skipped: number;
};

export type PackageImportResult = {
  ok: true;
  mode: "overwrite" | "skip";
  formatVersion: number;
  sourceSiteKey: string | null;
  contentTypes: PackageApplyCounters;
  fields: PackageApplyCounters;
  entries: PackageApplyCounters;
  forms: PackageApplyCounters;
  formFields: PackageApplyCounters;
  media: { imported: number; skipped: number };
  errors: string[];
};

export class CmsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "CmsApiError";
  }
}

export class CmsClient {
  private baseUrl: string;
  private token?: string | null;
  private siteKey?: string | null;
  private fetchImpl: typeof fetch;

  constructor(options: CmsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.siteKey = options.siteKey;
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  setToken(token: string | null) {
    this.token = token;
  }

  setSiteKey(siteKey: string | null) {
    this.siteKey = siteKey;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    opts: { auth?: boolean; site?: boolean } = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (opts.auth) {
      if (!this.token) {
        throw new CmsApiError("Authentication required", 401);
      }
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    if (opts.site) {
      if (!this.siteKey) {
        throw new CmsApiError("Site key required", 401);
      }
      headers.set("x-site-key", this.siteKey);
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;

    if (!res.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : `Request failed with status ${res.status}`;
      throw new CmsApiError(message, res.status, body);
    }

    return body as T;
  }

  health() {
    return this.request<{ status: string }>("/health");
  }

  register(input: RegisterInput) {
    return this.request<AuthResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  login(input: LoginInput) {
    return this.request<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  me() {
    return this.request<{
      user: AuthUser;
      websites: WebsiteMembership[];
      needsWebsiteSelection: boolean;
      authMethod?: string;
    }>("/api/v1/auth/me", {}, { auth: true });
  }

  listWebsites() {
    return this.request<WebsiteMembership[]>(
      "/api/v1/auth/websites",
      {},
      { auth: true },
    );
  }

  selectWebsite(input: SelectWebsiteInput) {
    return this.request<AuthResponse>(
      "/api/v1/auth/select-website",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  createWebsite(input: CreateWebsiteInput) {
    return this.request<AuthResponse>(
      "/api/v1/auth/websites",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  getWebsite() {
    return this.request<WebsiteDetails>("/api/v1/admin/website", {}, { auth: true });
  }

  updateWebsite(input: UpdateWebsiteInput) {
    return this.request<{
      website: WebsiteDetails;
      token: string | null;
      user: AuthUser | null;
      websites: WebsiteMembership[];
    }>(
      "/api/v1/admin/website",
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  listMembers() {
    return this.request<
      Array<{
        id: string;
        role: string;
        user: { id: string; email: string; name: string | null };
        createdAt: string;
      }>
    >("/api/v1/admin/members", {}, { auth: true });
  }

  addMember(input: AddMemberInput) {
    return this.request<{
      id: string;
      role: string;
      user: { id: string; email: string; name: string | null };
      createdAt: string;
      temporaryPassword?: string;
      warning?: string;
    }>(
      "/api/v1/admin/members",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  updateMember(id: string, input: UpdateMemberInput) {
    return this.request<{
      id: string;
      role: string;
      user: { id: string; email: string; name: string | null };
      createdAt: string;
    }>(
      `/api/v1/admin/members/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  removeMember(id: string) {
    return this.request<{ ok: true }>(
      `/api/v1/admin/members/${id}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  // Public (site key)
  listContentTypes() {
    return this.request<ContentType[]>(
      "/api/v1/content-types",
      {},
      { site: true },
    );
  }

  getContentType(apiId: string) {
    // Prefer admin path when authenticated (studio), else public site key.
    if (this.token) {
      return this.request<ContentType>(
        `/api/v1/admin/content-types/${apiId}`,
        {},
        { auth: true },
      );
    }
    return this.request<ContentType>(
      `/api/v1/content-types/${apiId}`,
      {},
      { site: true },
    );
  }

  listAdminContentTypes() {
    return this.request<ContentType[]>(
      "/api/v1/admin/content-types",
      {},
      { auth: true },
    );
  }

  listPublishedEntries(apiId: string, params: ListEntriesParams = {}) {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    if (params.slug) qs.set("slug", params.slug);
    if (params.locale) qs.set("locale", params.locale);
    if (params.sort) qs.set("sort", params.sort);
    if (params.order) qs.set("order", params.order);
    const query = qs.toString();
    return this.request<ListEntriesResult>(
      `/api/v1/content-types/${apiId}/entries${query ? `?${query}` : ""}`,
      {},
      { site: true },
    );
  }

  getPublishedEntry(
    apiId: string,
    slug: string,
    options?: string | { previewToken?: string; locale?: string },
  ) {
    const qs = new URLSearchParams();
    if (typeof options === "string") {
      qs.set("previewToken", options);
    } else if (options) {
      if (options.previewToken) qs.set("previewToken", options.previewToken);
      if (options.locale) qs.set("locale", options.locale);
    }
    const query = qs.toString();
    return this.request<FlatEntry>(
      `/api/v1/content-types/${apiId}/entries/${slug}${query ? `?${query}` : ""}`,
      {},
      { site: true },
    );
  }

  getLocales() {
    return this.request<PublicLocalesResponse>(
      "/api/v1/locales",
      {},
      { site: true },
    );
  }

  getBootstrap(locale?: string) {
    const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    return this.request<BootstrapPayload>(
      `/api/v1/bootstrap${qs}`,
      {},
      { site: true },
    );
  }

  getContentTypeSchema(apiId: string) {
    return this.request<Record<string, unknown>>(
      `/api/v1/content-types/${apiId}/schema.json`,
      {},
      { site: true },
    );
  }

  corsCheck(origin?: string) {
    const qs =
      origin != null && origin !== ""
        ? `?origin=${encodeURIComponent(origin)}`
        : "";
    return this.request<CorsCheckResult>(`/api/v1/cors-check${qs}`, {});
  }

  getOpenApi() {
    return this.request<Record<string, unknown>>("/api/v1/openapi.json", {});
  }

  // Admin
  createContentType(input: CreateContentTypeInput) {
    return this.request<ContentType>(
      "/api/v1/admin/content-types",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  updateContentType(apiId: string, input: UpdateContentTypeInput) {
    return this.request<ContentType>(
      `/api/v1/admin/content-types/${apiId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteContentType(apiId: string) {
    return this.request<{ ok: true }>(
      `/api/v1/admin/content-types/${apiId}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  createField(contentTypeApiId: string, input: CreateFieldDefinitionInput) {
    return this.request<ContentType>(
      `/api/v1/admin/content-types/${contentTypeApiId}/fields`,
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  updateField(
    contentTypeApiId: string,
    fieldApiId: string,
    input: UpdateFieldDefinitionInput,
  ) {
    return this.request<ContentType>(
      `/api/v1/admin/content-types/${contentTypeApiId}/fields/${fieldApiId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteField(contentTypeApiId: string, fieldApiId: string) {
    return this.request<ContentType>(
      `/api/v1/admin/content-types/${contentTypeApiId}/fields/${fieldApiId}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  listAdminEntries(apiId: string, params: ListEntriesParams = {}) {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    if (params.slug) qs.set("slug", params.slug);
    if (params.status) qs.set("status", params.status);
    if (params.locale) qs.set("locale", params.locale);
    if (params.sort) qs.set("sort", params.sort);
    if (params.order) qs.set("order", params.order);
    const query = qs.toString();
    return this.request<ListEntriesResult>(
      `/api/v1/admin/content-types/${apiId}/entries${query ? `?${query}` : ""}`,
      {},
      { auth: true },
    );
  }

  getAdminEntry(apiId: string, entryId: string) {
    return this.request<FlatEntry>(
      `/api/v1/admin/content-types/${apiId}/entries/by-id/${entryId}`,
      {},
      { auth: true },
    );
  }

  createPreviewToken(apiId: string, entryId: string) {
    return this.request<PreviewTokenResult>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/preview-token`,
      { method: "POST" },
      { auth: true },
    );
  }

  createEntry(apiId: string, input: CreateEntryInput) {
    return this.request<FlatEntry>(
      `/api/v1/admin/content-types/${apiId}/entries`,
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  createTranslation(
    apiId: string,
    entryId: string,
    input: CreateTranslationInput,
  ) {
    return this.request<FlatEntry>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/translations`,
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  syncMissingLocales(apiId: string, input: { dryRun?: boolean } = {}) {
    return this.request<{
      missing: Array<{ slug: string; locale: string; sourceEntryId: string }>;
      created: FlatEntry[];
    }>(
      `/api/v1/admin/content-types/${apiId}/sync-locales`,
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  updateEntry(apiId: string, entryId: string, input: UpdateEntryInput) {
    return this.request<FlatEntry>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteEntry(apiId: string, entryId: string) {
    return this.request<{ ok: true }>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  publishEntry(apiId: string, entryId: string) {
    return this.request<FlatEntry>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/publish`,
      { method: "POST" },
      { auth: true },
    );
  }

  unpublishEntry(apiId: string, entryId: string) {
    return this.request<FlatEntry>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/unpublish`,
      { method: "POST" },
      { auth: true },
    );
  }

  getAiStatus() {
    return this.request<AiStatus>("/api/v1/admin/ai/status", {}, { auth: true });
  }

  getContentRequestUsage() {
    return this.request<ContentRequestUsage>(
      "/api/v1/admin/analytics/content-requests",
      {},
      { auth: true },
    );
  }

  updateAiConfig(input: AiConfigUpdate) {
    return this.request<AiStatus>(
      "/api/v1/admin/ai/config",
      { method: "PUT", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  aiChat(input: AiChatRequest) {
    return this.request<AiChatResponse>(
      "/api/v1/admin/ai/chat",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  listEntryVersions(apiId: string, entryId: string) {
    return this.request<EntryVersion[]>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/versions`,
      {},
      { auth: true },
    );
  }

  createEntryVersion(
    apiId: string,
    entryId: string,
    input?: { label?: string },
  ) {
    return this.request<EntryVersion>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/versions`,
      { method: "POST", body: JSON.stringify(input ?? {}) },
      { auth: true },
    );
  }

  restoreEntryVersion(apiId: string, entryId: string, versionId: string) {
    return this.request<{ entry: FlatEntry; restoredFrom: EntryVersion }>(
      `/api/v1/admin/content-types/${apiId}/entries/${entryId}/versions/${versionId}/restore`,
      { method: "POST" },
      { auth: true },
    );
  }

  listApiTokens() {
    return this.request<
      Array<{
        id: string;
        name: string;
        prefix: string;
        lastUsedAt: string | null;
        expiresAt: string | null;
        createdAt: string;
      }>
    >("/api/v1/admin/tokens", {}, { auth: true });
  }

  createApiToken(input: { name: string; expiresInDays?: number }) {
    return this.request<{
      token: string;
      id: string;
      name: string;
      prefix: string;
      lastUsedAt: string | null;
      expiresAt: string | null;
      createdAt: string;
      warning: string;
    }>(
      "/api/v1/admin/tokens",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteApiToken(id: string) {
    return this.request<{ ok: true }>(
      `/api/v1/admin/tokens/${id}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  listUserApiTokens() {
    return this.request<
      Array<{
        id: string;
        name: string;
        prefix: string;
        lastUsedAt: string | null;
        expiresAt: string | null;
        createdAt: string;
      }>
    >("/api/v1/auth/user-tokens", {}, { auth: true });
  }

  createUserApiToken(input: { name: string; expiresInDays?: number }) {
    return this.request<{
      token: string;
      id: string;
      name: string;
      prefix: string;
      lastUsedAt: string | null;
      expiresAt: string | null;
      createdAt: string;
      warning: string;
    }>(
      "/api/v1/auth/user-tokens",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteUserApiToken(id: string) {
    return this.request<{ ok: true }>(
      `/api/v1/auth/user-tokens/${id}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  /**
   * Upload an image for a `media` field. Returns a public URL to store as the field value.
   */
  async uploadMedia(file: File | Blob, filename?: string) {
    if (!this.token) {
      throw new CmsApiError("Authentication required", 401);
    }
    const form = new FormData();
    const name =
      filename ?? (file instanceof File && file.name ? file.name : "upload.bin");
    form.append("file", file, name);

    const headers = new Headers();
    headers.set("Authorization", `Bearer ${this.token}`);

    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/admin/media`, {
      method: "POST",
      headers,
      body: form,
    });

    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const message =
        typeof body === "object" &&
        body &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : res.statusText || "Request failed";
      throw new CmsApiError(message, res.status, body);
    }
    return body as {
      url: string;
      filename: string;
      mimeType: string;
      size: number;
    };
  }

  /**
   * Idempotent upsert of content types, fields, and entries (site-building agents).
   */
  provision(input: {
    contentTypes: Array<{
      apiId: string;
      name: string;
      description?: string;
      fields?: Array<{
        apiId: string;
        name: string;
        type: string;
        required?: boolean;
        sortOrder?: number;
      }>;
      entries?: Array<{
        slug: string;
        locale?: string;
        status?: "draft" | "published";
        fields?: Record<string, unknown>;
      }>;
    }>;
  }) {
    return this.request<{
      ok: true;
      results: Array<{ contentType: ContentType; entries: FlatEntry[] }>;
    }>(
      "/api/v1/admin/provision",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  /**
   * Export selected content types / forms / media as an Aurora package ZIP.
   */
  async exportPackage(input: {
    contentTypeApiIds?: string[];
    entrySlugsByType?: Record<string, string[]>;
    formApiIds?: string[];
    includeMedia?: boolean;
  }) {
    if (!this.token) {
      throw new CmsApiError("Authentication required", 401);
    }
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Content-Type", "application/json");

    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/admin/packages/export`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentTypeApiIds: input.contentTypeApiIds ?? [],
          entrySlugsByType: input.entrySlugsByType,
          formApiIds: input.formApiIds ?? [],
          includeMedia: input.includeMedia ?? true,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        /* keep text */
      }
      const message =
        typeof body === "object" &&
        body &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : res.statusText || "Export failed";
      throw new CmsApiError(message, res.status, body);
    }

    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? "aurora-package.zip";
    const blob = await res.blob();
    return { blob, filename };
  }

  /**
   * Import an Aurora package ZIP into the active website.
   */
  async importPackage(
    file: File | Blob,
    options: { mode: "overwrite" | "skip"; filename?: string },
  ) {
    if (!this.token) {
      throw new CmsApiError("Authentication required", 401);
    }
    const form = new FormData();
    const name =
      options.filename ??
      (file instanceof File && file.name ? file.name : "aurora-package.zip");
    form.append("file", file, name);
    form.append("mode", options.mode);

    const headers = new Headers();
    headers.set("Authorization", `Bearer ${this.token}`);

    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/admin/packages/import`,
      {
        method: "POST",
        headers,
        body: form,
      },
    );

    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const message =
        typeof body === "object" &&
        body &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : res.statusText || "Import failed";
      throw new CmsApiError(message, res.status, body);
    }
    return body as PackageImportResult;
  }

  // --- Forms (public) ---

  getPublishedForm(apiId: string) {
    return this.request<Form>(`/api/v1/forms/${apiId}`, {}, { site: true });
  }

  submitForm(apiId: string, input: SubmitFormInput) {
    return this.request<SubmitFormResult>(
      `/api/v1/forms/${apiId}/submit`,
      { method: "POST", body: JSON.stringify(input) },
      { site: true },
    );
  }

  // --- Forms (admin) ---

  listForms() {
    return this.request<Form[]>("/api/v1/admin/forms", {}, { auth: true });
  }

  getForm(apiId: string) {
    return this.request<Form>(
      `/api/v1/admin/forms/${apiId}`,
      {},
      { auth: true },
    );
  }

  createForm(input: CreateFormInput) {
    return this.request<Form>(
      "/api/v1/admin/forms",
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  updateForm(apiId: string, input: UpdateFormInput) {
    return this.request<Form>(
      `/api/v1/admin/forms/${apiId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteForm(apiId: string) {
    return this.request<{ ok: true }>(
      `/api/v1/admin/forms/${apiId}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  createFormField(formApiId: string, input: CreateFormFieldInput) {
    return this.request<Form>(
      `/api/v1/admin/forms/${formApiId}/fields`,
      { method: "POST", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  updateFormField(
    formApiId: string,
    fieldApiId: string,
    input: UpdateFormFieldInput,
  ) {
    return this.request<Form>(
      `/api/v1/admin/forms/${formApiId}/fields/${fieldApiId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteFormField(formApiId: string, fieldApiId: string) {
    return this.request<Form>(
      `/api/v1/admin/forms/${formApiId}/fields/${fieldApiId}`,
      { method: "DELETE" },
      { auth: true },
    );
  }

  listFormSubmissions(
    formApiId: string,
    params: { limit?: number; offset?: number } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return this.request<{
      items: FormSubmission[];
      total: number;
      limit: number;
      offset: number;
    }>(
      `/api/v1/admin/forms/${formApiId}/submissions${query ? `?${query}` : ""}`,
      {},
      { auth: true },
    );
  }

  getFormSubmission(formApiId: string, submissionId: string) {
    return this.request<FormSubmission>(
      `/api/v1/admin/forms/${formApiId}/submissions/${submissionId}`,
      {},
      { auth: true },
    );
  }

  updateFormSubmission(
    formApiId: string,
    submissionId: string,
    input: UpdateFormSubmissionInput,
  ) {
    return this.request<FormSubmission>(
      `/api/v1/admin/forms/${formApiId}/submissions/${submissionId}`,
      { method: "PATCH", body: JSON.stringify(input) },
      { auth: true },
    );
  }

  deleteFormSubmission(formApiId: string, submissionId: string) {
    return this.request<{ ok: true }>(
      `/api/v1/admin/forms/${formApiId}/submissions/${submissionId}`,
      { method: "DELETE" },
      { auth: true },
    );
  }
}

export function createCmsClient(options: CmsClientOptions) {
  return new CmsClient(options);
}
