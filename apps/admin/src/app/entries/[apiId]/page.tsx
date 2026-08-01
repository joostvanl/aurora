import Link from "next/link";
import { notFound } from "next/navigation";
import { flagEmoji } from "@cms/shared";
import { getAdminClient } from "@/lib/cms";

export default async function EntriesListPage({
  params,
  searchParams,
}: {
  params: Promise<{ apiId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { apiId } = await params;
  const { locale: localeFilter } = await searchParams;
  const client = await getAdminClient();

  let type;
  let website;
  try {
    [type, website] = await Promise.all([
      client.getContentType(apiId),
      client.getWebsite(),
    ]);
  } catch {
    notFound();
  }

  const { items } = await client.listAdminEntries(apiId, {
    limit: 100,
    ...(localeFilter ? { locale: localeFilter } : {}),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{type.name} entries</h1>
          <p>
            Draft and publish content for the public API.
            {type.localizationMode === "all_locales"
              ? " Mode: all site languages."
              : " Mode: explicit languages."}
          </p>
        </div>
        <Link className="btn" href={`/entries/${apiId}/new`}>
          New entry
        </Link>
      </div>

      <div className="actions" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
        <Link
          className={`btn btn-secondary${!localeFilter ? " active" : ""}`}
          href={`/entries/${apiId}`}
        >
          All locales
        </Link>
        {website.locales.map((code) => (
          <Link
            key={code}
            className={`btn btn-secondary${localeFilter === code ? " active" : ""}`}
            href={`/entries/${apiId}?locale=${encodeURIComponent(code)}`}
          >
            {flagEmoji(code)} {code}
          </Link>
        ))}
      </div>

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Locale</th>
              <th>Status</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <code>{entry.slug}</code>
                </td>
                <td>
                  <span title={entry.locale}>
                    {flagEmoji(entry.locale)} <code>{entry.locale}</code>
                  </span>
                </td>
                <td>
                  <span className="badge" data-status={entry.status}>
                    {entry.status}
                  </span>
                </td>
                <td className="muted">
                  {new Date(entry.updatedAt).toLocaleString()}
                </td>
                <td>
                  <Link href={`/entries/${apiId}/${entry.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
