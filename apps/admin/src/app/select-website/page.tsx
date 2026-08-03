import { WebsitePicker } from "@/components/WebsitePicker";

export default function SelectWebsitePage() {
  return (
    <div className="auth-shell">
      <div className="auth-card panel">
        <div className="brand-lockup">
          <img src="/aurora-mark.png" alt="" width={36} height={36} />
          <div>
            <strong>Aurora</strong>
            <span>Select website</span>
          </div>
        </div>
        <WebsitePicker />
      </div>
    </div>
  );
}
