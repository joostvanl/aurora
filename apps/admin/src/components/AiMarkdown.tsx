"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  a({ href, children }) {
    const url = href ?? "";
    if (url.startsWith("/") && !url.startsWith("//")) {
      return (
        <Link href={url} className="ai-md-link">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={url}
        className="ai-md-link"
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    );
  },
  pre({ children }) {
    return <pre className="ai-md-pre">{children}</pre>;
  },
  code({ className, children, ...props }) {
    const isBlock = Boolean(className);
    return (
      <code
        className={isBlock ? className : "ai-md-code"}
        {...props}
      >
        {children}
      </code>
    );
  },
};

export function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
