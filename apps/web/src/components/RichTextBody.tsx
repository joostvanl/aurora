function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value.trim());
}

/** Renders richtext field values: HTML from the admin WYSIWYG, or plain text with line breaks. */
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

  return <Tag className={className}>{value}</Tag>;
}
