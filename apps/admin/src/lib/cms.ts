import { createCmsClient } from "@cms/shared";
import { cookies } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";

/** Server-only — do not import from Client Components (uses next/headers). */
export async function getAdminClient() {
  noStore();
  const baseUrl = process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000";
  const jar = await cookies();
  const rawToken = jar.get("aurora_cms_token")?.value ?? null;
  const token = rawToken ? decodeURIComponent(rawToken) : null;
  return createCmsClient({
    baseUrl,
    token,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        cache: "no-store",
        next: { revalidate: 0 },
      }),
  });
}
