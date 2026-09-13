import { DataSourcesStudio } from "./DataSourcesStudio";

export default function DataSourcesPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Databronnen</h1>
          <p>
            Configure Streamable HTTP MCP sources for this website. Studio-AI
            and scheduled tasks may call only these enabled sources — never an
            ad-hoc URL — and should write draft entries from the tool results.
          </p>
        </div>
      </div>
      <DataSourcesStudio />
    </>
  );
}
