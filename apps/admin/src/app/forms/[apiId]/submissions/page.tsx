import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { FormSubmissionsList } from "@/components/FormSubmissionsList";

export default async function FormSubmissionsPage({
  params,
}: {
  params: Promise<{ apiId: string }>;
}) {
  const { apiId } = await params;
  const client = await getAdminClient();
  let form;
  try {
    form = await client.getForm(apiId);
  } catch {
    notFound();
  }

  const { items, total } = await client.listFormSubmissions(apiId, {
    limit: 50,
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{form.name} inbox</h1>
          <p>
            Submissions for <code>{form.apiId}</code>
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-secondary" href={`/forms/${form.apiId}`}>
            Edit form
          </Link>
        </div>
      </div>

      <FormSubmissionsList
        formApiId={form.apiId}
        items={items}
        total={total}
      />
    </>
  );
}
