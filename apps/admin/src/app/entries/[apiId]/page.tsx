import { notFound } from "next/navigation";
import { EntriesList } from "@/components/EntriesList";
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

  // Load full page set; locale/status/search are applied client-side.
  const { items, total } = await client.listAdminEntries(apiId, {
    limit: 100,
    sort: "updatedAt",
    order: "desc",
  });

  return (
    <EntriesList
      apiId={apiId}
      type={type}
      website={website}
      initialItems={items}
      initialTotal={total}
      initialLocale={localeFilter}
    />
  );
}
