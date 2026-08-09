"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

export function DeleteContentTypeButton({
  apiId,
  name,
}: {
  apiId: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    const ok = confirm(
      `Content type "${name}" (${apiId}) permanent verwijderen?\n\nAlle velden en entries van dit type worden mee verwijderd. Dit kan niet ongedaan worden gemaakt.`,
    );
    if (!ok) return;

    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().deleteContentType(apiId);
      router.push("/content-types");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Verwijderen mislukt",
      );
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.35rem", justifyItems: "end" }}>
      <button
        type="button"
        className="btn btn-danger"
        disabled={pending}
        onClick={() => void onDelete()}
      >
        {pending ? "Verwijderen…" : "Verwijderen"}
      </button>
      {error && (
        <p style={{ color: "var(--danger)", margin: 0, fontSize: "0.85rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
