export type SnapshotDiffChange = {
  path: string;
  before: unknown;
  after: unknown;
};

function stableStringify(value: unknown): string {
  if (value === undefined) return "__undefined__";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function pushIfChanged(
  changes: SnapshotDiffChange[],
  path: string,
  before: unknown,
  after: unknown,
) {
  if (valuesEqual(before, after)) return;
  changes.push({ path, before, after });
}

/** Shallow field-level diff for entry snapshots (meta + field apiIds). */
export function diffEntrySnapshots(
  from: {
    slug?: string;
    status?: string;
    locale?: string;
    fields?: Record<string, unknown>;
  },
  to: {
    slug?: string;
    status?: string;
    locale?: string;
    fields?: Record<string, unknown>;
  },
): SnapshotDiffChange[] {
  const changes: SnapshotDiffChange[] = [];
  pushIfChanged(changes, "slug", from.slug ?? null, to.slug ?? null);
  pushIfChanged(changes, "status", from.status ?? null, to.status ?? null);
  pushIfChanged(changes, "locale", from.locale ?? null, to.locale ?? null);

  const fromFields = from.fields ?? {};
  const toFields = to.fields ?? {};
  const keys = new Set([...Object.keys(fromFields), ...Object.keys(toFields)]);
  for (const key of [...keys].sort()) {
    const before = Object.prototype.hasOwnProperty.call(fromFields, key)
      ? fromFields[key]
      : undefined;
    const after = Object.prototype.hasOwnProperty.call(toFields, key)
      ? toFields[key]
      : undefined;
    pushIfChanged(changes, `fields.${key}`, before, after);
  }
  return changes;
}

type CtField = {
  apiId: string;
  name?: string;
  type?: string;
  required?: boolean;
  sortOrder?: number;
  settings?: unknown;
};

/** Diff content-type snapshots (type meta + each field def by apiId). */
export function diffContentTypeSnapshots(
  from: {
    apiId?: string;
    name?: string;
    description?: string | null;
    localizationMode?: string;
    fields?: CtField[];
  },
  to: {
    apiId?: string;
    name?: string;
    description?: string | null;
    localizationMode?: string;
    fields?: CtField[];
  },
): SnapshotDiffChange[] {
  const changes: SnapshotDiffChange[] = [];
  pushIfChanged(changes, "apiId", from.apiId ?? null, to.apiId ?? null);
  pushIfChanged(changes, "name", from.name ?? null, to.name ?? null);
  pushIfChanged(
    changes,
    "description",
    from.description ?? null,
    to.description ?? null,
  );
  pushIfChanged(
    changes,
    "localizationMode",
    from.localizationMode ?? null,
    to.localizationMode ?? null,
  );

  const fromMap = new Map((from.fields ?? []).map((f) => [f.apiId, f]));
  const toMap = new Map((to.fields ?? []).map((f) => [f.apiId, f]));
  const apiIds = new Set([...fromMap.keys(), ...toMap.keys()]);

  for (const apiId of [...apiIds].sort()) {
    const a = fromMap.get(apiId);
    const b = toMap.get(apiId);
    if (!a && b) {
      changes.push({ path: `fields.${apiId}`, before: undefined, after: b });
      continue;
    }
    if (a && !b) {
      changes.push({ path: `fields.${apiId}`, before: a, after: undefined });
      continue;
    }
    if (!a || !b) continue;
    for (const prop of ["name", "type", "required", "sortOrder", "settings"] as const) {
      pushIfChanged(
        changes,
        `fields.${apiId}.${prop}`,
        a[prop] ?? null,
        b[prop] ?? null,
      );
    }
  }

  return changes;
}
