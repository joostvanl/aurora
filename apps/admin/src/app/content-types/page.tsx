import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { CreateContentTypeForm } from "@/components/CreateContentTypeForm";

export default async function ContentTypesPage() {
  const client = await getAdminClient();
  try {
    const me = await client.me();
    if (me.user.role === "editor") {
      redirect("/");
    }
  } catch {
    redirect("/login");
  }

  const types = await client.listAdminContentTypes();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Content types</h1>
          <p>Define the shape of your content. Fields drive the entry editor.</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.25rem" }}>
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>API ID</th>
                <th>Fields</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    <code>{t.apiId}</code>
                  </td>
                  <td>{t.fields?.length ?? 0}</td>
                  <td>
                    <Link href={`/content-types/${t.apiId}`}>Manage</Link>
                  </td>
                </tr>
              ))}
              {types.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    No content types yet. Create one below or run the seed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0, fontFamily: "var(--font-display)", fontWeight: 500 }}>
            New content type
          </h2>
          <CreateContentTypeForm />
        </div>
      </div>
    </>
  );
}
