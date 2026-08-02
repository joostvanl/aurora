import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const DEFAULT_MAX_CHARS = 14_000;
const HARD_MAX_CHARS = 40_000;
const MAX_BODY_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_LINKS = 40;
const USER_AGENT = "AuroraCMS-AI/1.0";

export type WebFetchLink = { href: string; text: string };

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  text: string;
  truncated: boolean;
  links: WebFetchLink[];
};

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebFetchError";
  }
}

function clampMaxChars(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(HARD_MAX_CHARS, Math.max(1_000, Math.floor(value)));
}

function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
    if (normalized.startsWith("fe80")) return true; // link-local
    // IPv4-mapped IPv6
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    return false;
  }
  return true;
}

async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebFetchError("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebFetchError("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new WebFetchError("URLs with credentials are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new WebFetchError("Local or internal hosts are not allowed");
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new WebFetchError("Private or reserved IP addresses are not allowed");
    }
    return url;
  }

  let addresses: string[];
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new WebFetchError(`Could not resolve host: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new WebFetchError(`Could not resolve host: ${hostname}`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new WebFetchError(
        "Host resolves to a private or reserved address and is not allowed",
      );
    }
  }

  return url;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

function stripNoiseTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  const title = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return title || null;
}

function extractLinks(html: string, baseUrl: string): WebFetchLink[] {
  const links: WebFetchLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && links.length < MAX_LINKS) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const hrefRaw = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:")) {
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(hrefRaw, baseUrl).toString();
    } catch {
      continue;
    }
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    links.push({ href: absolute, text });
  }
  return links;
}

function htmlToText(html: string): string {
  const withoutNoise = stripNoiseTags(html);
  const withBreaks = withoutNoise
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br|hr)\s*>/gi, "\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(ul|ol|table)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text;
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars).trimEnd() + "…", truncated: true };
}

async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new WebFetchError(`Response larger than ${maxBytes} bytes`);
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new WebFetchError(`Response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetch a public URL for the in-app AI assistant (SSRF-safe, text extraction).
 */
export async function fetchPublicUrl(
  rawUrl: string,
  options?: { maxChars?: number },
): Promise<WebFetchResult> {
  const maxChars = clampMaxChars(options?.maxChars);
  let current = await assertSafeUrl(rawUrl);
  const requestedUrl = current.toString();

  let response: Response | null = null;
  let finalUrl = requestedUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
          "User-Agent": USER_AGENT,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new WebFetchError("Request timed out");
      }
      throw new WebFetchError(
        error instanceof Error ? error.message : "Fetch failed",
      );
    } finally {
      clearTimeout(timer);
    }

    finalUrl = current.toString();
    const status = response.status;

    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new WebFetchError(`Redirect without Location header (${status})`);
      }
      if (redirect === MAX_REDIRECTS) {
        throw new WebFetchError("Too many redirects");
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new WebFetchError("Invalid redirect Location");
      }
      current = await assertSafeUrl(next.toString());
      continue;
    }

    break;
  }

  if (!response) {
    throw new WebFetchError("Fetch failed");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new WebFetchError(`HTTP ${response.status} for ${finalUrl}`);
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase() || "application/octet-stream";

  const body = await readBodyLimited(response, MAX_BODY_BYTES);
  const charsetMatch = (response.headers.get("content-type") ?? "").match(
    /charset=([^\s;]+)/i,
  );
  const charset = charsetMatch?.[1]?.replace(/["']/g, "") || "utf-8";
  let rawText: string;
  try {
    rawText = new TextDecoder(charset, { fatal: false }).decode(body);
  } catch {
    rawText = new TextDecoder("utf-8", { fatal: false }).decode(body);
  }

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml")
  ) {
    const title = extractTitle(rawText);
    const links = extractLinks(stripNoiseTags(rawText), finalUrl);
    const { text, truncated } = truncateText(htmlToText(rawText), maxChars);
    return {
      url: requestedUrl,
      finalUrl,
      status: response.status,
      contentType,
      title,
      text,
      truncated,
      links,
    };
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("application/json") ||
    contentType.includes("application/xml") ||
    contentType.includes("+json") ||
    contentType.includes("+xml")
  ) {
    const { text, truncated } = truncateText(rawText.trim(), maxChars);
    return {
      url: requestedUrl,
      finalUrl,
      status: response.status,
      contentType,
      title: null,
      text,
      truncated,
      links: [],
    };
  }

  throw new WebFetchError(
    `Unsupported content type: ${contentType || "unknown"}`,
  );
}
