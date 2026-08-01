import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { EntryEditor } from "@/components/EntryEditor";

export default async function NewEntryPage({
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

  return <EntryEditor contentType={type} />;
}
