import React from 'react';
import AdminAuthGate from '../components/auth/AdminAuthGate.jsx';

const adminLinks = [
  { href: '/admin', label: 'Accueil' },
  { href: '/admin/bulletins', label: 'Bulletins' },
  { href: '/admin/carte-publiee', label: 'Carte publiée' },
  { href: '/admin/carte-a-publier', label: 'Carte à publier' },
  { href: '/admin/secteurs', label: 'Secteurs' },
  { href: '/admin/entreprises', label: 'Entreprises' },
];

export default function AdminLayout({ children }) {
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

  return (
    <AdminAuthGate>
      <div className="site-shell admin-shell">
      <aside className="admin-sidebar">
        <a className="brand admin-brand" href="/admin">
          <span className="brand-mark">AF</span>
          <span>
            <strong>ApprentiFR</strong>
            <small>Administration</small>
          </span>
        </a>

        <nav className="admin-nav" aria-label="Navigation administration">
          {adminLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={currentPath === link.href ? 'active' : ''}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <a className="admin-public-link" href="/">
          Voir le public
        </a>
      </aside>

      <main className="admin-main">{children}</main>
      </div>
    </AdminAuthGate>
  );
}
