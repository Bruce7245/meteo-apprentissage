import React from 'react';

// Keep administration CSS isolated from the public landing pages.
import './admin-console.css';
import './admin-console-mobile.css';
import './admin-console-pages.css';

import AdminHomePage from './pages/admin/AdminHomePage.jsx';
import AdminBulletinsPage from './pages/admin/AdminBulletinsPage.jsx';
import AdminStatsPage from './pages/admin/AdminStatsPage.jsx';
import AdminOccupationOffersPage from './pages/admin/AdminOccupationOffersPage.jsx';
import AdminNationalStatsPage from './pages/admin/AdminNationalStatsPage.jsx';
import AdminPublishedMapPage from './pages/admin/AdminPublishedMapPage.jsx';
import AdminDraftMapPage from './pages/admin/AdminDraftMapPage.jsx';
import AdminSectorDashboardPage from './pages/admin/AdminSectorDashboardPage.jsx';
import AdminCompaniesDashboardPage from './pages/admin/AdminCompaniesDashboardPage.jsx';

const adminRoutes = {
  '/admin': AdminHomePage,
  '/admin/bulletins': AdminBulletinsPage,
  '/admin/stats': AdminNationalStatsPage,
  '/admin/stats/metiers': AdminOccupationOffersPage,
  '/admin/stats/vigilance': AdminStatsPage,
  '/admin/carte-publiee': AdminPublishedMapPage,
  '/admin/carte-a-publier': AdminDraftMapPage,
  '/admin/secteurs': AdminSectorDashboardPage,
  '/admin/entreprises': AdminCompaniesDashboardPage,
};

export default function AdminRoutes({ path }) {
  const Page = adminRoutes[path];

  if (!Page) {
    return (
      <main className="not-found-page">
        <section className="panel">
          <p className="kicker">Page introuvable</p>
          <h1>404</h1>
          <p>Cette page n’existe pas ou n’est pas encore reconstruite.</p>
          <a className="button-link" href="/">Retour à la carte publique</a>
        </section>
      </main>
    );
  }

  return <Page />;
}
