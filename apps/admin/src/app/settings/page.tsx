import { SettingsHub } from "@/components/SettingsHub";

export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>
            Website configuration, members, AI, and account-level website
            switching.
          </p>
        </div>
      </div>
      <SettingsHub />
    </>
  );
}
