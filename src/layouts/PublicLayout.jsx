import React from 'react';
import '../occupation.css';

function getNavigationState() {
  if (typeof window === 'undefined') {
    return {
      mapActive: true,
      occupationActive: false,
    };
  }

  const path = window.location.pathname;
  const departmentPath = path.startsWith('/departement/');
  const hasRome = new URLSearchParams(window.location.search).has('rome');

  return {
    mapActive:
      path === '/' ||
      (departmentPath && !hasRome),
    occupationActive:
      path === '/metiers' ||
      (departmentPath && hasRome),
  };
}

export default function PublicLayout({ children }) {
  const navigation = getNavigationState();

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

          <nav className="public-primary-nav" aria-label="Navigation publique">
            <a
              className={
                navigation.mapActive
                  ? 'public-nav-link is-active'
                  : 'public-nav-link'
              }
              href="/"
              aria-current={navigation.mapActive ? 'page' : undefined}
            >
              Carte nationale
            </a>
            <a
              className={
                navigation.occupationActive
                  ? 'public-nav-link is-active'
                  : 'public-nav-link'
              }
              href="/metiers"
              aria-current={navigation.occupationActive ? 'page' : undefined}
            >
              Métiers & formations
            </a>
          </nav>

          <div className="public-header-context" aria-label="Nature du service">
            <span className="status-dot" aria-hidden="true" />
            <span>Données publiées quotidiennement</span>
          </div>
        </div>
      </header>

      <main className="site-main public-main">{children}</main>

      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="public-footer-brand">
            <img
              className="public-footer-brand-image"
              src="/apprenti_fr_BP.png"
              alt="ApprentiFR"
            />
          </div>
          <p className="public-footer-note">
            Les niveaux présentés sont des indicateurs d’observation et ne constituent pas une information officielle de l’État.
          </p>
        </div>
      </footer>
    </div>
  );
}
