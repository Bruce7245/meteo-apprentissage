import React from 'react';
import PublicMapPage from './pages/public/PublicMapPage.jsx';
import PublicDepartmentPage from './pages/public/PublicDepartmentPage.jsx';
import PublicOccupationMapPage from './pages/public/PublicOccupationMapPage.jsx';
import AdminHomePage from './pages/admin/AdminHomePage.jsx';
import AdminBulletinsPage from './pages/admin/AdminBulletinsPage.jsx';
import AdminStatsPage from './pages/admin/AdminStatsPage.jsx';
import AdminOccupationOffersPage from './pages/admin/AdminOccupationOffersPage.jsx';
import AdminNationalStatsPage from './pages/admin/AdminNationalStatsPage.jsx';
import AdminPublishedMapPage from './pages/admin/AdminPublishedMapPage.jsx';
import AdminDraftMapPage from './pages/admin/AdminDraftMapPage.jsx';
import AdminSectorDashboardPage from './pages/admin/AdminSectorDashboardPage.jsx';
import AdminCompaniesDashboardPage from './pages/admin/AdminCompaniesDashboardPage.jsx';
import AdminSettingsPage from './pages/admin/AdminSettingsPage.jsx';
import {
  isValidDepartmentCode,
  normalizeDepartmentCode,
} from './utils/departmentUtils.js';
import './App.css';

function normalizePath(pathname) {
  return pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

function NotFoundPage() {
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

function App() {
  const path = normalizePath(window.location.pathname);

  if (path === '/') return <PublicMapPage />;
  if (path === '/metiers') return <PublicOccupationMapPage />;

  const departmentMatch = path.match(/^\/departement\/([^/]+)$/);

  if (departmentMatch) {
    let departmentCode = '';

    try {
      departmentCode = normalizeDepartmentCode(
        decodeURIComponent(departmentMatch[1])
      );
    } catch {
      return <NotFoundPage />;
    }

    if (!isValidDepartmentCode(departmentCode)) {
      return <NotFoundPage />;
    }

    return <PublicDepartmentPage departmentCode={departmentCode} />;
  }

  if (path === '/admin') return <AdminHomePage />;
  if (path === '/admin/bulletins') return <AdminBulletinsPage />;
  if (path === '/admin/stats') return <AdminNationalStatsPage />;
  if (path === '/admin/stats/metiers') return <AdminOccupationOffersPage />;
  if (path === '/admin/stats/vigilance') return <AdminStatsPage />;
  if (path === '/admin/carte-publiee') return <AdminPublishedMapPage />;
  if (path === '/admin/carte-a-publier') return <AdminDraftMapPage />;
  if (path === '/admin/secteurs') return <AdminSectorDashboardPage />;
  if (path === '/admin/entreprises') return <AdminCompaniesDashboardPage />;
  if (path === '/admin/parametrage') return <AdminSettingsPage />;

  return <NotFoundPage />;
}

export default App;
