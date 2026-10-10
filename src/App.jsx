import React, { Suspense, lazy } from 'react';
import PublicMapPage from './pages/public/PublicMapPage.jsx';
import {
  isValidDepartmentCode,
  normalizeDepartmentCode,
} from './utils/departmentUtils.js';
import './App.css';

// The national homepage remains eager to preserve its initial content.
// Other routes load their code and CSS only when the visitor opens them.
const PublicDepartmentPage = lazy(() => import('./pages/public/PublicDepartmentPage.jsx'));
const PublicOccupationMapPage = lazy(() => import('./pages/public/PublicOccupationMapPage.jsx'));
const AdminRoutes = lazy(() => import('./AdminRoutes.jsx'));

function DeferredPage({ children }) {
  return (
    <Suspense fallback={
      <main className="site-main" role="status" aria-live="polite">
        Chargement de la page…
      </main>
    }>
      {children}
    </Suspense>
  );
}

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
  if (path === '/metiers') return <DeferredPage><PublicOccupationMapPage /></DeferredPage>;

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

    return <DeferredPage><PublicDepartmentPage departmentCode={departmentCode} /></DeferredPage>;
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return <DeferredPage><AdminRoutes path={path} /></DeferredPage>;
  }

  return <NotFoundPage />;
}

export default App;
