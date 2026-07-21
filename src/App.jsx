import React from 'react';
import PublicMapPage from './pages/public/PublicMapPage.jsx';
import PublicDepartmentPage from './pages/public/PublicDepartmentPage.jsx';
import AdminHomePage from './pages/admin/AdminHomePage.jsx';
import AdminBulletinsPage from './pages/admin/AdminBulletinsPage.jsx';
import AdminPublishedMapPage from './pages/admin/AdminPublishedMapPage.jsx';
import AdminDraftMapPage from './pages/admin/AdminDraftMapPage.jsx';
import AdminSectorDashboardPage from './pages/admin/AdminSectorDashboardPage.jsx';
import AdminCompaniesDashboardPage from './pages/admin/AdminCompaniesDashboardPage.jsx';
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
  if (path === '/admin/carte-publiee') return <AdminPublishedMapPage />;
  if (path === '/admin/carte-a-publier') return <AdminDraftMapPage />;
  if (path === '/admin/secteurs') return <AdminSectorDashboardPage />;
  if (path === '/admin/entreprises') return <AdminCompaniesDashboardPage />;

  return <NotFoundPage />;
}

export default App;
