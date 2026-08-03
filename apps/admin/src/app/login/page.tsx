import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card panel">
        <div className="brand-lockup">
          <img src="/aurora-mark.png" alt="" width={36} height={36} />
          <div>
            <strong>Aurora</strong>
            <span>Sign in to Studio</span>
          </div>
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
