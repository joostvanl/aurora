import { WebsitePicker } from "@/components/WebsitePicker";

export default function SelectWebsitePage() {
  return (
    <div className="auth-shell">
      <div className="auth-card panel">
        <div className="brand" style={{ marginBottom: "1rem" }}>
          Aurora
          <span>Select website</span>
        </div>
        <WebsitePicker />
      </div>
    </div>
  );
}
