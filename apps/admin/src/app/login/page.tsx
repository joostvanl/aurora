import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card panel">
        <div className="brand" style={{ color: "var(--ink)", marginBottom: "1rem" }}>
          Aurora
          <span style={{ color: "var(--muted)" }}>Sign in</span>
        </div>
        <p className="muted">
          Each account has its own content types, entries, and AI settings.
        </p>
        <LoginForm mode="login" />
        <p className="muted" style={{ marginTop: "1rem" }}>
          New here? <Link href="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
