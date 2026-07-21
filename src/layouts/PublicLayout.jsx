import React from 'react';

export default function PublicLayout({ children }) {
  return (
    <div className="site-shell public-shell">
      <header className="site-header">
        <a className="brand" href="/">
          <span className="brand-mark">AF</span>
          <span>
            <strong>ApprentiFR</strong>
            <small>Vigilance apprentissage</small>
          </span>
        </a>

        <nav className="site-nav" aria-label="Navigation publique">
          <a href="/">Carte des vigilances</a>
          <a href="/admin">Admin</a>
        </nav>
      </header>

      <main className="site-main">{children}</main>
    </div>
  );
}
