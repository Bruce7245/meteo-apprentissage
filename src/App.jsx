import React from 'react';
import AdminObservatoryPage from './AdminObservatoryPage';
import BulletinAdminPage from './BulletinAdminPage';
import PublicDepartmentBulletinPage from './PublicDepartmentBulletinPage';
import PublicHomePage from './PublicHomePage';
import './App.css';

function NotFoundPage() {
  return (
    <div className="admin-page">
      <main className="admin-card">
        <p className="admin-kicker">Page introuvable</p>
        <h1>404</h1>
        <p>Cette page n’existe pas ou n’est pas accessible.</p>
      </main>
    </div>
  );
}

function App() {
  const path = window.location.pathname;

  if (path === '/') {
    return <PublicHomePage />;
  }

  if (path.startsWith('/bulletin/')) {
    const departmentCode = decodeURIComponent(path.replace('/bulletin/', '').replace(/\/$/, ''));
    return <PublicDepartmentBulletinPage departmentCode={departmentCode} />;
  }

  if (path === '/pilotage-bulletins') {
    return <BulletinAdminPage />;
  }

  if (path === '/pilotage-observatoire') {
    return <AdminObservatoryPage />;
  }

  return <NotFoundPage />;
}

export default App;
