import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";

export default function RegisterPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card panel">
        <div className="brand" style={{ color: "var(--ink)", marginBottom: "1rem" }}>
          Aurora
          <span style={{ color: "var(--muted)" }}>Create account</span>
        </div>
        <p className="muted">
          A new login starts with an empty CMS. Import or create types as you go.
        </p>
        <LoginForm mode="register" />
        <p className="muted" style={{ marginTop: "1rem" }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
