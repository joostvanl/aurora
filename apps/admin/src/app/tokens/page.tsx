import { TokensManager } from "@/components/TokensManager";

export default function TokensPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>API tokens</h1>
          <p>
            Management tokens for agents and automation. Scoped to this website
            with admin-level access.
          </p>
        </div>
      </div>
      <TokensManager />
    </>
  );
}
