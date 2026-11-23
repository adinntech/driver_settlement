"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApi } from "@/hooks/useApi";
import BackendStatus from "@/components/BackendStatus";
import { homeFor } from "@/utils/budgetDescribe";
import type { RoleKey, RolesMap } from "@/types/domain";

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const roles = useApi<RolesMap>("/auth/roles");
  const [role, setRole] = useState<RoleKey | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(homeFor(user.role));
  }, [ready, user, router]);

  function choose(r: RoleKey) {
    setRole(r);
    setUsername(roles.data?.[r].defaultUsername ?? ""); // auto-fill username
    setPassword("");
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!role) return;
    setBusy(true);
    setError("");
    try {
      const u = await login(role, username.trim(), password);
      router.replace(homeFor(u.role));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <span className="brand-mark big">DS</span>
        <h1>Driver Settlement</h1>
        <p>Roadshow &amp; Signage job tracking and budget management in one place.</p>
        <BackendStatus />
      </section>
      <section className="login-panel">
        <h2>Sign in</h2>
        <p className="muted">Choose your login type to continue.</p>

        {roles.error && <div className="alert">{roles.error}</div>}
        <div className="role-grid">
          {(["RSOP", "RBP", "RSOM", "RSA"] as RoleKey[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`role-card${role === r ? " selected" : ""}`}
              onClick={() => choose(r)}
              disabled={!roles.data}
            >
              <strong>{r} Login</strong>
              <span>{roles.data?.[r].description ?? "Loading…"}</span>
            </button>
          ))}
        </div>

        {role && (
          <form onSubmit={submit} className="login-form fade-in">
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </label>
            {error && <div className="alert" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Signing in…" : `Sign in as ${role}`}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
