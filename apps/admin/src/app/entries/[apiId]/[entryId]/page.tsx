import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/cms";
import { EntryEditor } from "@/components/EntryEditor";

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ apiId: string; entryId: string }>;
}) {
  const { apiId, entryId } = await params;
  const client = await getAdminClient();

  let type;
  let entry;
  try {
    type = await client.getContentType(apiId);
    entry = await client.getAdminEntry(apiId, entryId);
  } catch {
    notFound();
  }

  return <EntryEditor contentType={type} entry={entry} />;
}
