import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { FormManager } from "@/components/FormManager";

export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ apiId: string }>;
}) {
  const { apiId } = await params;
  const client = await getAdminClient();

  try {
    const me = await client.me();
    if (me.user.role === "editor") {
      redirect(`/forms/${apiId}/submissions`);
    }
  } catch {
    redirect("/login");
  }

  let form;
  try {
    form = await client.getForm(apiId);
  } catch {
    notFound();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{form.name}</h1>
          <p>
            API ID <code>{form.apiId}</code>
            {form.description ? ` · ${form.description}` : ""}
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-secondary" href="/forms">
            Back
          </Link>
          <Link className="btn" href={`/forms/${form.apiId}/submissions`}>
            Submissions
          </Link>
        </div>
      </div>

      <FormManager form={form} />
    </>
  );
}
