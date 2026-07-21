import React from 'react';
import PublicMapPage from './pages/public/PublicMapPage.jsx';
import PublicDepartmentPage from './pages/public/PublicDepartmentPage.jsx';
import AdminHomePage from './pages/admin/AdminHomePage.jsx';
import AdminBulletinsPage from './pages/admin/AdminBulletinsPage.jsx';
import AdminPublishedMapPage from './pages/admin/AdminPublishedMapPage.jsx';
import AdminDraftMapPage from './pages/admin/AdminDraftMapPage.jsx';
import AdminSectorDashboardPage from './pages/admin/AdminSectorDashboardPage.jsx';
import AdminCompaniesDashboardPage from './pages/admin/AdminCompaniesDashboardPage.jsx';
import './App.css';

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
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

  if (path.startsWith('/departement/')) {
    const departmentCode = decodeURIComponent(path.replace('/departement/', ''));
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
