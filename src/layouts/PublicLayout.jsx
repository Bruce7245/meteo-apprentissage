import React from 'react';

export default function PublicLayout({ children }) {
  return (
    <div className="site-shell public-shell">
      <header className="public-header">
        <div className="public-header-inner">
          <a className="public-brand" href="/" aria-label="ApprentiFR — Accueil">
            <span className="public-brand-mark" aria-hidden="true">AF</span>
            <span className="public-brand-copy">
              <strong>ApprentiFR</strong>
              <small>Observatoire territorial de l’apprentissage</small>
            </span>
          </a>

          <div className="public-header-context" aria-label="Nature du service">
            <span className="status-dot" aria-hidden="true" />
            <span>Données publiées quotidiennement</span>
          </div>
        </div>
      </header>

      <main className="site-main public-main">{children}</main>

      <footer className="public-footer">
        <div className="public-footer-inner">
          <div>
            <strong>ApprentiFR</strong>
            <p>Lecture territoriale du marché de l’apprentissage.</p>
          </div>
          <p className="public-footer-note">
            Les niveaux présentés sont des indicateurs d’observation et ne constituent pas une information officielle de l’État.
          </p>
        </div>
      </footer>
    </div>
  );
}
