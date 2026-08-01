import { PackagesManager } from "@/components/PackagesManager";

export default function PackagesPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Packages</h1>
          <p>
            Export and import content packages (types, entries, forms, and
            media) between Aurora websites or instances.
          </p>
        </div>
      </div>
      <PackagesManager />
    </>
  );
}
