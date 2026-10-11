import React, { useState } from 'react';
import '../occupation.css';
import '../public-home.css';

function getNavigationState() {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname;
  const hasRome = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('rome');
  return {
    homeActive: path === '/',
    mapActive: path.startsWith('/departement/') && !hasRome,
    occupationActive: path === '/metiers' || (path.startsWith('/departement/') && hasRome),
  };
}

export default function PublicLayout({ children }) {
  const navigation = getNavigationState();
  const [menuOpen, setMenuOpen] = useState(false);
  const onHome = navigation.homeActive;
  return (
    <div className={'site-shell public-shell' + (onHome ? ' public-home-shell' : '')}>
      <header className="public-header">
        <div className="public-header-inner">
          <a className="public-brand public-brand-logo" href="/" aria-label="ApprentiFR — Accueil">
            <span className="public-logo-crop">
              <img src="/apprenti_fr_BP.png" alt="ApprentiFR" width="1366" height="768" decoding="async" />
            </span>
          </a>
          <button type="button" className="public-menu-toggle" aria-controls="public-site-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            {menuOpen ? 'Fermer' : 'Menu'} <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
          </button>
          <nav className={'public-primary-nav public-site-nav' + (menuOpen ? ' is-open' : '')} id="public-site-navigation" aria-label="Navigation publique">
            <a className={'public-nav-link' + (navigation.homeActive ? ' is-active' : '')} href="/" aria-current={navigation.homeActive ? 'page' : undefined}>Accueil</a>
            <a className={'public-nav-link' + (navigation.mapActive ? ' is-active' : '')} href="/#carte" aria-current={navigation.mapActive ? 'page' : undefined}>Territoires</a>
            <a className={'public-nav-link' + (navigation.occupationActive ? ' is-active' : '')} href="/metiers" aria-current={navigation.occupationActive ? 'page' : undefined}>Métiers & formations</a>
            <a className="public-nav-link" href="/#situation">Observatoire</a>
          </nav>
          <a className="public-header-action" href="/admin">Espace admin</a>
        </div>
      </header>
      <main className="site-main public-main">{children}</main>
      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="public-footer-brand">
            <span className="footer-project-name">ApprentiFR</span>
            <span>Observatoire territorial de l'apprentissage</span>
          </div>
          <p className="public-footer-note">Les niveaux de vigilance sont des indicateurs d'observation et ne constituent pas une information officielle de l'État. Les données manquantes ne présument pas d'une situation favorable.</p>
        </div>
      </footer>
    </div>
  );
}
