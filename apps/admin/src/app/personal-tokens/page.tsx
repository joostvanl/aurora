import { UserTokensManager } from "@/components/UserTokensManager";

export default function PersonalTokensPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Personal access tokens</h1>
          <p>
            User-scoped tokens (<code>aur_u_…</code>) for MCP and agents. Rights
            follow your membership role on each website you select.
          </p>
        </div>
      </div>
      <UserTokensManager />
    </>
  );
}
