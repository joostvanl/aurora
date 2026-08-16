import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { ContentTypeVersions } from "@/components/ContentTypeVersions";
import { DeleteContentTypeButton } from "@/components/DeleteContentTypeButton";
import { FieldManager } from "@/components/FieldManager";
import { LocalizationModeEditor } from "@/components/LocalizationModeEditor";

export default async function ContentTypeDetailPage({
  params,
}: {
  params: Promise<{ apiId: string }>;
}) {
  const { apiId } = await params;
  const client = await getAdminClient();
  try {
    const me = await client.me();
    if (me.user.role === "editor") {
      redirect("/");
    }
  } catch {
    redirect("/login");
  }

  let type;
  try {
    type = await client.getContentType(apiId);
  } catch {
    notFound();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{type.name}</h1>
          <p>
            API ID <code>{type.apiId}</code>
            {type.description ? ` · ${type.description}` : ""}
            {" · "}
            Localization: <code>{type.localizationMode ?? "explicit"}</code>
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-secondary" href="/content-types">
            Back
          </Link>
          <Link className="btn" href={`/entries/${type.apiId}`}>
            View entries
          </Link>
          <DeleteContentTypeButton apiId={type.apiId} name={type.name} />
        </div>
      </div>

      <LocalizationModeEditor contentType={type} />
      <FieldManager contentType={type} />
      <ContentTypeVersions contentType={type} />
    </>
  );
}
