"use client";

import type { AiChatContext, FlatEntry } from "@cms/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type AiScreenHints = {
  page?: string;
  contentTypeApiId?: string;
  entryId?: string;
  formApiId?: string;
  mode?: AiChatContext["mode"];
  websiteName?: string;
};

export type AiDockCommand = {
  message: string;
  mode?: AiChatContext["mode"];
};

export type AiEntryUpdatedDetail = {
  entry: FlatEntry;
  versionCreated?: { id: string; label: string | null; createdAt: string } | null;
};

const AI_ENTRY_UPDATED = "aurora:ai-entry-updated";
const AI_STUDIO_MUTATED = "aurora:ai-studio-mutated";

export function dispatchAiEntryUpdated(detail: AiEntryUpdatedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_ENTRY_UPDATED, { detail }));
}

export function onAiEntryUpdated(
  handler: (detail: AiEntryUpdatedDetail) => void,
) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    handler((e as CustomEvent<AiEntryUpdatedDetail>).detail);
  };
  window.addEventListener(AI_ENTRY_UPDATED, listener);
  return () => window.removeEventListener(AI_ENTRY_UPDATED, listener);
}

/** Fired after the AI applies CMS mutations so the open page can reload. */
export function dispatchAiStudioMutated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_STUDIO_MUTATED));
}

export function onAiStudioMutated(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AI_STUDIO_MUTATED, handler);
  return () => window.removeEventListener(AI_STUDIO_MUTATED, handler);
}

function deriveFromPathname(pathname: string): AiScreenHints {
  if (pathname === "/" || pathname === "") {
    return { page: "Dashboard" };
  }
  if (pathname === "/content-types") {
    return { page: "Content types" };
  }
  const contentTypeMatch = pathname.match(/^\/content-types\/([^/]+)$/);
  if (contentTypeMatch) {
    return {
      page: "Content type schema",
      contentTypeApiId: decodeURIComponent(contentTypeMatch[1]),
    };
  }
  if (pathname === "/forms") {
    return { page: "Forms" };
  }
  const formSubMatch = pathname.match(
    /^\/forms\/([^/]+)\/submissions(?:\/|$)/,
  );
  if (formSubMatch) {
    return {
      page: "Form submissions",
      formApiId: decodeURIComponent(formSubMatch[1]),
    };
  }
  const formMatch = pathname.match(/^\/forms\/([^/]+)$/);
  if (formMatch) {
    return {
      page: "Form editor",
      formApiId: decodeURIComponent(formMatch[1]),
    };
  }
  const entryEdit = pathname.match(/^\/entries\/([^/]+)\/([^/]+)$/);
  if (entryEdit) {
    return {
      page: "Entry editor",
      contentTypeApiId: decodeURIComponent(entryEdit[1]),
      entryId: decodeURIComponent(entryEdit[2]),
    };
  }
  const entryList = pathname.match(/^\/entries\/([^/]+)$/);
  if (entryList) {
    return {
      page: "Entry list",
      contentTypeApiId: decodeURIComponent(entryList[1]),
    };
  }
  if (pathname === "/tokens") return { page: "API tokens" };
  if (pathname === "/website") return { page: "Website settings" };
  if (pathname === "/members") return { page: "Members" };
  if (pathname === "/ai") return { page: "AI settings" };
  if (pathname === "/select-website") return { page: "Websites" };
  return { page: pathname };
}

type AiScreenContextValue = {
  context: AiChatContext;
  setHints: (hints: AiScreenHints | null) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  expandDock: () => void;
  dockWidth: number;
  setDockWidth: (width: number) => void;
  /** Queued prompt for the dock (null when idle). */
  dockCommand: AiDockCommand | null;
  runDockPrompt: (command: AiDockCommand) => void;
  clearDockCommand: () => void;
};

const AiScreenContext = createContext<AiScreenContextValue | null>(null);

const COLLAPSE_KEY = "aurora_ai_dock_collapsed";
const WIDTH_KEY = "aurora_ai_dock_width";
export const AI_DOCK_WIDTH_DEFAULT = 340;
export const AI_DOCK_WIDTH_MIN = 280;
export const AI_DOCK_WIDTH_MAX = 720;

function clampDockWidth(width: number) {
  return Math.min(AI_DOCK_WIDTH_MAX, Math.max(AI_DOCK_WIDTH_MIN, Math.round(width)));
}

export function AiScreenProvider({
  children,
  websiteName,
}: {
  children: ReactNode;
  websiteName?: string | null;
}) {
  const pathname = usePathname() ?? "/";
  const [hints, setHintsState] = useState<AiScreenHints | null>(null);
  const [collapsed, setCollapsedState] = useState(false);
  const [dockWidth, setDockWidthState] = useState(AI_DOCK_WIDTH_DEFAULT);
  const [dockCommand, setDockCommand] = useState<AiDockCommand | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      if (stored === "1") setCollapsedState(true);
      if (stored === "0") setCollapsedState(false);
      const storedWidth = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setDockWidthState(clampDockWidth(storedWidth));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setHintsState(null);
  }, [pathname]);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const setDockWidth = useCallback((width: number) => {
    const next = clampDockWidth(width);
    setDockWidthState(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const setHints = useCallback((next: AiScreenHints | null) => {
    setHintsState(next);
  }, []);

  const expandDock = useCallback(() => {
    setCollapsed(false);
  }, [setCollapsed]);

  const runDockPrompt = useCallback(
    (command: AiDockCommand) => {
      setCollapsed(false);
      setDockCommand(command);
    },
    [setCollapsed],
  );

  const clearDockCommand = useCallback(() => {
    setDockCommand(null);
  }, []);

  const context = useMemo((): AiChatContext => {
    const fromPath = deriveFromPathname(pathname);
    return {
      pathname,
      page: hints?.page ?? fromPath.page,
      contentTypeApiId: hints?.contentTypeApiId ?? fromPath.contentTypeApiId,
      entryId: hints?.entryId ?? fromPath.entryId,
      formApiId: hints?.formApiId ?? fromPath.formApiId,
      mode: hints?.mode ?? "general",
      websiteName: hints?.websiteName ?? websiteName ?? undefined,
    };
  }, [pathname, hints, websiteName]);

  const value = useMemo(
    () => ({
      context,
      setHints,
      collapsed,
      setCollapsed,
      expandDock,
      dockWidth,
      setDockWidth,
      dockCommand,
      runDockPrompt,
      clearDockCommand,
    }),
    [
      context,
      setHints,
      collapsed,
      setCollapsed,
      expandDock,
      dockWidth,
      setDockWidth,
      dockCommand,
      runDockPrompt,
      clearDockCommand,
    ],
  );

  return (
    <AiScreenContext.Provider value={value}>{children}</AiScreenContext.Provider>
  );
}

export function useAiScreen() {
  const ctx = useContext(AiScreenContext);
  if (!ctx) {
    throw new Error("useAiScreen must be used within AiScreenProvider");
  }
  return ctx;
}
