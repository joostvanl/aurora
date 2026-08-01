import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { FieldManager } from "@/components/FieldManager";

export default async function ContentTypeDetailPage({
  params,
}: {
  params: Promise<{ apiId: string }>;
}) {
  const { apiId } = await params;
  let type;
  try {
    type = await (await getAdminClient()).getContentType(apiId);
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
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-secondary" href="/content-types">
            Back
          </Link>
          <Link className="btn" href={`/entries/${type.apiId}`}>
            View entries
          </Link>
        </div>
      </div>

      <FieldManager contentType={type} />
    </>
  );
}
