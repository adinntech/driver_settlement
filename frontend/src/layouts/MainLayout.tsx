import type { ReactNode } from "react";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="header">
        <div className="container header-inner">
          <strong>Driver Settlement</strong>
        </div>
      </header>
      <main className="container main">{children}</main>
      <footer className="footer">
        <div className="container">Driver Settlement</div>
      </footer>
    </div>
  );
}
