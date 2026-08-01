import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/cms";

export default async function EntriesListPage({
  params,
}: {
  params: Promise<{ apiId: string }>;
}) {
  const { apiId } = await params;
  const client = await getAdminClient();

  let type;
  try {
    type = await client.getContentType(apiId);
  } catch {
    notFound();
  }

  const { items } = await client.listAdminEntries(apiId, { limit: 100 });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{type.name} entries</h1>
          <p>Draft and publish content for the public API.</p>
        </div>
        <Link className="btn" href={`/entries/${apiId}/new`}>
          New entry
        </Link>
      </div>

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Slug</th>
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
                <td colSpan={4} className="empty">
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
