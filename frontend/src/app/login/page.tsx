"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApi } from "@/hooks/useApi";
import { useBackendStatus } from "@/hooks/useBackendStatus";
import { homeFor } from "@/utils/budgetDescribe";
import { API_BASE_URL, BASE_PATH } from "@/utils/config";
import type { RoleKey, RolesMap } from "@/types/domain";

/** Workspace labels shown on the role picker (the server's role list still decides which roles exist and their usernames). */
const WORKSPACES: { role: RoleKey; title: string; hint: string }[] = [
  { role: "RSOP", title: "Project Management", hint: "Create roadshow & signage requests" },
  { role: "RBP", title: "Budget & Vehicle Operations", hint: "Budgets, vehicles, drivers, delivery" },
  { role: "RSOM", title: "Budget Approval", hint: "Approve budgets and daily payments" },
  { role: "RSA", title: "Payments & Administration", hint: "Clearance, payments, completion" },
  { role: "RSO", title: "Final Settlement Approval & Reports", hint: "Final settlements, salary PDFs, reports" },
];

const FLOW = [
  { k: "Project", d: "RSOP raises the request" },
  { k: "Budget", d: "RBP plans · RSOM approves" },
  { k: "Vehicle", d: "Allotted and delivered" },
  { k: "Driver", d: "Cleared by RSA" },
  { k: "Settlement", d: "Paid and accounted" },
];

type DemoMap = Partial<Record<RoleKey, { username: string; password: string }>>;

const STATUS_TEXT = { checking: "Connecting to server", online: "Server connected", offline: "Server unreachable" } as const;

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const roles = useApi<RolesMap>("/auth/roles");
  const status = useBackendStatus();
  const [role, setRole] = useState<RoleKey | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const [demo, setDemo] = useState<DemoMap | null>(null); // development-only hints; null = feature off (server answers 404)
  const [demoPinned, setDemoPinned] = useState(false); // opened by click / keyboard: stays open
  const [demoPeek, setDemoPeek] = useState(false); // hover preview
  const demoOpen = demoPinned || demoPeek;

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE_URL}/auth/demo-credentials`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j?.success && j.data && setDemo(j.data as DemoMap))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready && user) router.replace(homeFor(user.role));
  }, [ready, user, router]);

  // cacheComponents keeps this page alive (hidden) after sign-in. Reset the form when it is hidden, so it never comes back
  // still "Signing in…" with every workspace disabled, and the password does not stay in memory.
  useLayoutEffect(() => {
    return () => {
      setBusy(false);
      setPassword("");
      setShow(false);
      setError("");
      setTouched(false);
      setRole(null);
      setDemoPinned(false);
      setDemoPeek(false);
    };
  }, []);

  const available = WORKSPACES.filter((w) => !roles.data || roles.data[w.role]);

  function choose(r: RoleKey) {
    setRole(r);
    setUsername(roles.data?.[r]?.defaultUsername ?? ""); // prefilled from the server (RSO comes from RSO_USERNAME)
    setPassword("");
    setShow(false);
    setError("");
    setTouched(false);
    setDemoPinned(false);
    setDemoPeek(false);
    requestAnimationFrame(() => pwRef.current?.focus());
  }

  const missing = { user: !username.trim(), pass: !password };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!role || missing.user || missing.pass || busy) return;
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

  const selected = WORKSPACES.find((w) => w.role === role);
  const demoFor = role && demo ? demo[role] : undefined;
  const useDemo = () => {
    if (!demoFor) return;
    setUsername(demoFor.username);
    setPassword(demoFor.password);
    setTouched(false);
    setError("");
  };

  return (
    <div className="lx">
      {/* ------------------------------------------------ brand panel */}
      <aside className="lx-brand">
        <div className="lx-brand-top">
          {/* white artwork with the original red accents, transparent background, original aspect ratio */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lx-logo" src={`${BASE_PATH}/adinn-logo-white.png`} alt="Adinn Advertising Services Ltd." width={1300} height={514} />

        </div>

        <div className="lx-brand-body">
          <p className="lx-eyebrow">Adinn Advertising Services Ltd.</p>
          <h1 className="lx-title">Driver{" "}<br />Settlement</h1>
          <p className="lx-lede">
            One operations desk for roadshow and signage campaigns: requests, budgets and approvals, vehicle and driver
            allotment, on-road delivery and every driver payment through to final settlement.
          </p>

          <ol className="lx-flow" aria-label="Settlement workflow">
            {FLOW.map((s, i) => (
              <li key={s.k} style={{ ["--i" as string]: i }}>
                <span className="lx-flow-node" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                <span className="lx-flow-text"><b>{s.k}</b><small>{s.d}</small></span>
              </li>
            ))}
          </ol>
        </div>

        <div className="lx-brand-foot">
          <span className={`lx-status is-${status}`} role="status">
            <i aria-hidden />
            {STATUS_TEXT[status]}
          </span>
          <span className="lx-foot-note">Roadshow · Signage · Settlement</span>
        </div>
      </aside>

      {/* ------------------------------------------------ authentication */}
      <main className="lx-auth">
        <div className="lx-auth-inner">
          <header className="lx-auth-head">
            <h2>Welcome back #3</h2>
            <p>Select your workspace to continue.</p>
          </header>

          {roles.error && <div className="lx-alert" role="alert">Cannot load workspaces: {roles.error}</div>}

          <section className={`lx-card${role ? " has-role" : ""}`}>
          <p className="lx-card-label">Workspace</p>
          <div className="lx-roles" role="radiogroup" aria-label="Workspace">
            {available.map((w) => {
              const on = role === w.role;
              return (
                <button
                  key={w.role}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`lx-role${on ? " is-on" : ""}`}
                  onClick={() => choose(w.role)}
                  disabled={!roles.data || busy}
                >
                  <span className="lx-role-code">{w.role}</span>
                  <span className="lx-role-text">
                    <b>{w.title}</b>
                    <small>{w.hint}</small>
                  </span>
                  <span className="lx-role-mark" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </button>
              );
            })}
            {!roles.data && !roles.error && Array.from({ length: 5 }, (_, i) => <span key={i} className="lx-role is-loading" aria-hidden />)}
          </div>

          <div className={`lx-form-wrap${role ? " is-open" : ""}`} aria-hidden={!role}>
            {role && selected && (
              <form onSubmit={submit} className="lx-form" noValidate>
                <p className="lx-form-for">Signing in to <b>{selected.role}</b> · {selected.title}</p>
                <label className={`lx-field${touched && missing.user ? " is-invalid" : ""}`}>
                  <span>Username</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} aria-invalid={touched && missing.user} />
                  {touched && missing.user && <small className="lx-field-error">Enter your username</small>}
                </label>
                <label className={`lx-field${touched && missing.pass ? " is-invalid" : ""}`}>
                  <span>Password</span>
                  <span className="lx-pass">
                    <input ref={pwRef} type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={touched && missing.pass} />
                    <button type="button" className={`lx-eye${show ? " is-shown" : ""}`} onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
                      <svg className="lx-eye-open" width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                      <svg className="lx-eye-shut" width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                    </button>
                  </span>
                  {touched && missing.pass && <small className="lx-field-error">Enter your password</small>}
                </label>
                {error && <div className="lx-alert" role="alert">{error}</div>}
                {status === "offline" && !error && <div className="lx-alert is-soft" role="status">The server is not reachable right now. Signing in may fail until it is back.</div>}
                <button className="lx-submit" disabled={busy}>
                  {busy ? <><span className="lx-spin" aria-hidden /> Signing in…</> : <>Sign in to {selected.role}<span aria-hidden className="lx-arrow">→</span></>}
                </button>
                {demoFor && (
                  <div className={`lx-demo${demoOpen ? " is-open" : ""}`} onMouseEnter={() => setDemoPeek(true)} onMouseLeave={() => setDemoPeek(false)}>
                    <button type="button" className="lx-demo-toggle" aria-expanded={demoOpen} onClick={() => { setDemoPinned((v) => !v); setDemoPeek(false); }}>
                      <span className="lx-demo-badge">DEV</span> Demo access for {selected.role}
                      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <div className="lx-demo-body" aria-hidden={!demoOpen}>
                      <dl>
                        <div><dt>Username</dt><dd>{demoFor.username}</dd></div>
                        <div><dt>Password</dt><dd>{demoFor.password}</dd></div>
                      </dl>
                      <button type="button" className="lx-demo-use" onClick={useDemo} tabIndex={demoOpen ? 0 : -1}>Use these</button>
                      <small>Development environment only · never shown in production</small>
                    </div>
                  </div>
                )}
              </form>
            )}
          </div>
          </section>

          <footer className="lx-auth-foot">© Adinn Advertising Services Ltd. · Authorised users only</footer>
        </div>
      </main>
    </div>
  );
}
