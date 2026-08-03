"use client";

import type {
  AiChatMessage,
  AiStatus,
  AiToolCallResult,
  AuthUser,
} from "@cms/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";
import { AiMarkdown } from "@/components/AiMarkdown";
import {
  AI_DOCK_WIDTH_MAX,
  AI_DOCK_WIDTH_MIN,
  dispatchAiEntryUpdated,
  dispatchAiStudioMutated,
  useAiScreen,
} from "@/components/AiScreenContext";

const FRONTEND_BRIEF_HEADING = "## Frontend agent brief (copy-paste)";

function hasFrontendBrief(content: string) {
  return content.includes(FRONTEND_BRIEF_HEADING);
}

function extractFrontendBrief(content: string): string {
  const idx = content.indexOf(FRONTEND_BRIEF_HEADING);
  if (idx < 0) return content;
  return content.slice(idx).trim();
}

async function copyFrontendBrief(content: string) {
  const text = extractFrontendBrief(content);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

export function AiAssistantDock({ user }: { user: AuthUser | null }) {
  const router = useRouter();
  const {
    context,
    collapsed,
    setCollapsed,
    dockWidth,
    setDockWidth,
    dockCommand,
    clearDockCommand,
  } = useAiScreen();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [toolLog, setToolLog] = useState<AiToolCallResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resizing, setResizing] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef(history);
  const sendingRef = useRef(false);
  const contextRef = useRef(context);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(dockWidth);

  historyRef.current = history;
  contextRef.current = context;

  useEffect(() => {
    getBrowserAdminClient()
      .getAiStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [user?.websiteId]);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history, pending]);

  useEffect(() => {
    if (!resizing) return;

    function onMove(e: PointerEvent) {
      const delta = dragStartX.current - e.clientX;
      setDockWidth(dragStartWidth.current + delta);
    }

    function onUp() {
      setResizing(false);
    }

    document.body.classList.add("ai-dock-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      document.body.classList.remove("ai-dock-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing, setDockWidth]);

  const sendMessage = useCallback(
    async (
      userMessage: string,
      modeOverride?: NonNullable<typeof context.mode>,
    ) => {
      if (!userMessage.trim() || sendingRef.current) return;
      sendingRef.current = true;
      setPending(true);
      setError(null);
      const prior = historyRef.current;
      const nextHistory = [
        ...prior,
        { role: "user" as const, content: userMessage },
      ];
      setHistory(nextHistory);
      try {
        const screen = contextRef.current;
        const res = await getBrowserAdminClient().aiChat({
          message: userMessage,
          history: prior,
          context: {
            ...screen,
            mode: modeOverride ?? screen.mode ?? "general",
          },
        });
        setHistory([
          ...nextHistory,
          { role: "assistant", content: res.reply },
        ]);
        setToolLog((prev) => [...prev, ...res.toolCalls].slice(-24));
        if (res.entry) {
          dispatchAiEntryUpdated({
            entry: res.entry,
            versionCreated: res.versionCreated,
          });
        }
        const mutated =
          Boolean(res.entry) || res.toolCalls.some((t) => t.ok);
        if (mutated) {
          dispatchAiStudioMutated();
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "AI request failed");
      } finally {
        setPending(false);
        sendingRef.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    if (!dockCommand) return;
    const { message: cmdMessage, mode } = dockCommand;
    clearDockCommand();
    void sendMessage(cmdMessage, mode);
  }, [dockCommand, clearDockCommand, sendMessage]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    setMessage("");
    await sendMessage(text);
  }

  const contextLabel = [
    context.page,
    context.contentTypeApiId,
    context.entryId ? "entry" : null,
    context.formApiId ? `form:${context.formApiId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (collapsed) {
    return null;
  }

  return (
    <aside
      className={`ai-dock${resizing ? " ai-dock--resizing" : ""}`}
      aria-label="AI assistant"
      style={{ ["--ai-dock" as string]: `${dockWidth}px` }}
    >
      <div
        className="ai-dock-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI assistant"
        aria-valuenow={dockWidth}
        aria-valuemin={AI_DOCK_WIDTH_MIN}
        aria-valuemax={AI_DOCK_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          dragStartX.current = e.clientX;
          dragStartWidth.current = dockWidth;
          setResizing(true);
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setDockWidth(dockWidth + 16);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setDockWidth(dockWidth - 16);
          }
        }}
      />
      <div className="ai-dock-header">
        <div>
          <strong>Aurora AI</strong>
          <div className="muted ai-dock-context" title={context.pathname}>
            {contextLabel || "Studio"}
          </div>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setCollapsed(true)}
        >
          Close
        </button>
      </div>

      {status && !status.enabled && (
        <p className="muted ai-dock-banner">
          AI is not configured.{" "}
          {user?.role === "admin" ? (
            <Link href="/ai">Open AI settings</Link>
          ) : (
            "Ask a website admin to set the provider."
          )}
        </p>
      )}

      <div className="ai-thread ai-dock-thread" ref={threadRef}>
        {history.length === 0 && (
          <div className="empty">
            Ask to create a page or edit this screen — the assistant saves
            changes in the CMS with tools. Changes stay within your role (
            {user?.role ?? "…"}).
          </div>
        )}
        {history.map((m, i) => (
          <div key={`${m.role}-${i}`} className={`ai-bubble ai-${m.role}`}>
            <div className="ai-role">{m.role}</div>
            {m.role === "assistant" ? (
              <AiMarkdown content={m.content} />
            ) : (
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            )}
            {m.role === "assistant" && hasFrontendBrief(m.content) && (
              <button
                className="btn btn-secondary ai-copy-brief"
                type="button"
                onClick={() => void copyFrontendBrief(m.content)}
              >
                Copy frontend agent brief
              </button>
            )}
          </div>
        ))}
        {pending && (
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Working…
          </div>
        )}
      </div>

      {toolLog.length > 0 && (
        <div className="ai-tools ai-dock-tools">
          {toolLog.slice(-8).map((t, i) => (
            <div key={`${t.name}-${i}`} className="muted">
              {t.ok ? "✓" : "✗"} <code>{t.name}</code> — {t.summary}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p
          style={{
            color: "var(--danger)",
            margin: "0.5rem 0 0",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </p>
      )}

      {context.entryId && context.contentTypeApiId && (
        <div className="ai-dock-quick">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!status?.enabled || pending}
            onClick={() =>
              void sendMessage(
                "Write compelling content for empty or weak fields on this entry. Keep brand voice clear and concrete. You must update fields with tools.",
                "write",
              )
            }
          >
            Write
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!status?.enabled || pending}
            onClick={() =>
              void sendMessage(
                "Optimize this entry for clarity, scannability, and SEO. Prefer small find/replace edits. You must update fields with tools.",
                "optimize",
              )
            }
          >
            Optimize
          </button>
        </div>
      )}

      <form className="ai-dock-form" onSubmit={(e) => void onSubmit(e)}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe the CMS change…"
          disabled={!status?.enabled || pending}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const text = message.trim();
              if (!text || pending) return;
              setMessage("");
              void sendMessage(text);
            }
          }}
        />
        <button
          className="btn"
          type="submit"
          disabled={!status?.enabled || pending || !message.trim()}
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}
