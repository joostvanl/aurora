import { UtilitiesHub } from "@/components/UtilitiesHub";

export default function UtilitiesPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Utilities</h1>
          <p>
            Developer and ops tools for this website — tokens, packages, and
            related helpers.
          </p>
        </div>
      </div>
      <UtilitiesHub />
    </>
  );
}
