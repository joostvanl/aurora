import { WebsiteSettings } from "@/components/WebsiteSettings";

export default function WebsitePage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Website</h1>
          <p>
            Studio identity for this tenant. Public brand and chrome live in{" "}
            <code>site_settings</code> content, not here.
          </p>
        </div>
      </div>
      <WebsiteSettings />
    </>
  );
}
