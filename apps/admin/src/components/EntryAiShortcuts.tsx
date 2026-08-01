"use client";

import { useAiScreen } from "@/components/AiScreenContext";

/** Entry-page shortcuts that drive the global AI dock (no separate chat panel). */
export function EntryAiShortcuts({
  entryId,
  hasContent,
}: {
  entryId?: string;
  hasContent: boolean;
}) {
  const { runDockPrompt, expandDock } = useAiScreen();

  if (!entryId) {
    return (
      <p className="muted" style={{ margin: "0 0 1rem" }}>
        Save the entry once to unlock Write / Optimize in the AI dock.
      </p>
    );
  }

  return (
    <div className="actions" style={{ marginBottom: "1rem" }}>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={() => {
          expandDock();
          runDockPrompt({
            mode: "write",
            message:
              "Write compelling content for empty or weak fields on this entry. Keep brand voice clear and concrete. You must update fields with tools.",
          });
        }}
      >
        Write with AI
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={!hasContent}
        onClick={() => {
          expandDock();
          runDockPrompt({
            mode: "optimize",
            message:
              "Optimize this entry for clarity, scannability, and SEO. Prefer small find/replace edits. You must update fields with tools.",
          });
        }}
      >
        Optimize with AI
      </button>
    </div>
  );
}
