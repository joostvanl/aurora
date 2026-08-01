function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value.trim());
}

/** Renders richtext field values: HTML from the admin WYSIWYG, or plain text with paragraphs. */
export function RichTextBody({
  value,
  className = "body",
  as: Tag = "div",
}: {
  value: string;
  className?: string;
  as?: "div" | "p";
}) {
  if (!value) return null;

  if (looksLikeHtml(value)) {
    return (
      <Tag
        className={`${className} richtext-html`}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }

  const paragraphs = value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return (
      <Tag className={className} style={{ whiteSpace: "pre-wrap" }}>
        {value}
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ whiteSpace: "pre-wrap" }}>
          {p}
        </p>
      ))}
    </Tag>
  );
}
