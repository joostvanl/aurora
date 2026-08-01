"use client";

import type { Form, FormField } from "@cms/shared";
import { createCmsClient } from "@cms/shared";
import { useEffect, useMemo, useState } from "react";

function publicClient() {
  const baseUrl =
    process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000";
  const siteKey =
    process.env.NEXT_PUBLIC_CMS_SITE_KEY ?? process.env.CMS_SITE_KEY;
  if (!siteKey) {
    throw new Error("NEXT_PUBLIC_CMS_SITE_KEY is not set");
  }
  return createCmsClient({ baseUrl, siteKey });
}

export function CmsForm({ apiId }: { apiId: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setSuccess(null);
    publicClient()
      .getPublishedForm(apiId)
      .then((schema) => {
        if (cancelled) return;
        setForm(schema);
        const initial: Record<string, unknown> = {};
        for (const field of schema.fields ?? []) {
          initial[field.apiId] = field.type === "checkbox" ? false : "";
        }
        setValues(initial);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load form");
      });
    return () => {
      cancelled = true;
    };
  }, [apiId]);

  const visibleFields = useMemo(
    () => (form?.fields ?? []).filter((f) => f.type !== "honeypot"),
    [form],
  );
  const honeypotFields = useMemo(
    () => (form?.fields ?? []).filter((f) => f.type === "honeypot"),
    [form],
  );

  function setField(apiIdKey: string, value: unknown) {
    setValues((prev) => ({ ...prev, [apiIdKey]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setPending(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      const result = await publicClient().submitForm(form.apiId, {
        fields: values,
      });
      setSuccess(result.message);
      const reset: Record<string, unknown> = {};
      for (const field of form.fields ?? []) {
        reset[field.apiId] = field.type === "checkbox" ? false : "";
      }
      setValues(reset);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setPending(false);
    }
  }

  if (loadError) {
    return <p className="meta">{loadError}</p>;
  }

  if (!form) {
    return <p className="meta">Loading form…</p>;
  }

  if (success) {
    return (
      <div className="cms-form cms-form--success">
        <p>{success}</p>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => setSuccess(null)}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form className="cms-form" onSubmit={onSubmit} noValidate>
      {visibleFields.map((field) => (
        <FormFieldInput
          key={field.id}
          field={field}
          value={values[field.apiId]}
          onChange={(v) => setField(field.apiId, v)}
        />
      ))}

      {honeypotFields.map((field) => (
        <div
          key={field.id}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            height: 0,
            overflow: "hidden",
          }}
        >
          <label htmlFor={`hp-${field.apiId}`}>{field.label}</label>
          <input
            id={`hp-${field.apiId}`}
            tabIndex={-1}
            autoComplete="off"
            value={String(values[field.apiId] ?? "")}
            onChange={(e) => setField(field.apiId, e.target.value)}
          />
        </div>
      ))}

      {submitError && <p className="cms-form__error">{submitError}</p>}

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Sending…" : form.submitLabel}
      </button>
    </form>
  );
}

function FormFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `cms-form-${field.apiId}`;
  const help = field.helpText ? (
    <span className="cms-form__help">{field.helpText}</span>
  ) : null;

  if (field.type === "checkbox") {
    return (
      <label className="cms-form__check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          required={field.required}
        />
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {help}
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="cms-form__field">
        <label htmlFor={id}>
          {field.label}
          {field.required ? " *" : ""}
        </label>
        <textarea
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          required={field.required}
          rows={5}
        />
        {help}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="cms-form__field">
        <label htmlFor={id}>
          {field.label}
          {field.required ? " *" : ""}
        </label>
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <fieldset className="cms-form__field">
        <legend>
          {field.label}
          {field.required ? " *" : ""}
        </legend>
        {(field.options ?? []).map((o) => (
          <label key={o.value} className="cms-form__check">
            <input
              type="radio"
              name={field.apiId}
              value={o.value}
              checked={String(value ?? "") === o.value}
              onChange={() => onChange(o.value)}
              required={field.required}
            />
            <span>{o.label}</span>
          </label>
        ))}
        {help}
      </fieldset>
    );
  }

  const inputType =
    field.type === "email"
      ? "email"
      : field.type === "phone"
        ? "tel"
        : field.type === "number"
          ? "number"
          : "text";

  return (
    <div className="cms-form__field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      <input
        id={id}
        type={inputType}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(
            field.type === "number"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
        placeholder={field.placeholder ?? undefined}
        required={field.required}
      />
      {help}
    </div>
  );
}
