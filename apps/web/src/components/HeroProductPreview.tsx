type PreviewLine = {
  label: string;
  value: string;
};

type HeroProductPreviewProps = {
  siteKeyHint?: string;
  lines: PreviewLine[];
};

export function HeroProductPreview({
  siteKeyHint = "demo-site-key",
  lines,
}: HeroProductPreviewProps) {
  const shown = lines.slice(0, 4);

  return (
    <aside className="hero-product" aria-label="Aurora public API preview">
      <div className="hero-product-chrome">
        <span className="hero-product-dot" />
        <span className="hero-product-dot" />
        <span className="hero-product-dot" />
        <span className="hero-product-title">Public Content API</span>
      </div>
      <pre className="hero-product-code">
        <code>
          <span className="tok-muted">GET</span>{" "}
          <span className="tok-accent">/api/v1/content-types/service/entries</span>
          {"\n"}
          <span className="tok-muted">x-site-key:</span>{" "}
          <span className="tok-ink">{siteKeyHint}</span>
          {"\n"}
          <span className="tok-muted">?locale=</span>
          <span className="tok-ink">en-US</span>
          <span className="tok-muted">&amp;sort=</span>
          <span className="tok-ink">sortOrder</span>
        </code>
      </pre>
      <ul className="hero-product-list">
        {shown.map((line) => (
          <li key={line.label}>
            <span className="hero-product-label">{line.label}</span>
            <span className="hero-product-value">{line.value}</span>
          </li>
        ))}
        {shown.length === 0 && (
          <li>
            <span className="hero-product-label">status</span>
            <span className="hero-product-value">published entries appear here</span>
          </li>
        )}
      </ul>
      <p className="hero-product-footnote">
        Schema-driven JSON · site-scoped · publish to go live
      </p>
    </aside>
  );
}
