import React from 'react';
import {
  FiActivity,
  FiBriefcase,
  FiChevronRight,
  FiFileText,
  FiGrid,
  FiHome,
  FiMap,
  FiMapPin,
  FiMonitor,
} from 'react-icons/fi';
import AdminAuthGate from '../components/auth/AdminAuthGate.jsx';

const adminGroups = [
  {
    label: 'Pilotage',
    links: [
      { href: '/admin', label: 'Vue d’ensemble', icon: FiHome },
      { href: '/admin/bulletins', label: 'Bulletins', icon: FiFileText },
    ],
  },
  {
    label: 'Publication',
    links: [
      { href: '/admin/carte-publiee', label: 'Carte publiée', icon: FiMap },
      { href: '/admin/carte-a-publier', label: 'Prépublication', icon: FiMonitor },
    ],
  },
  {
    label: 'Analyse',
    links: [
      { href: '/admin/secteurs', label: 'Moteur métiers', icon: FiActivity },
      { href: '/admin/entreprises', label: 'Entreprises', icon: FiBriefcase },
    ],
  },
];

function isActivePath(currentPath, href) {
  return href === '/admin'
    ? currentPath === href
    : currentPath === href || currentPath.startsWith(href + '/');
}

export default function AdminLayout({ children }) {
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

  return (
    <AdminAuthGate>
      <div className="admin-console">
        <aside className="admin-console-sidebar">
          <div className="admin-console-brand-wrap">
            <a className="admin-console-brand" href="/admin" aria-label="Accueil administration ApprentiFR">
              <span className="admin-console-logo" aria-hidden="true">AF</span>
              <span className="admin-console-brand-copy">
                <strong>ApprentiFR</strong>
                <small>Console d’administration</small>
              </span>
            </a>
            <span className="admin-console-environment">PRODUCTION</span>
          </div>

          <nav className="admin-console-nav" aria-label="Navigation administration">
            {adminGroups.map((group) => (
              <div className="admin-console-nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.links.map((link) => {
                  const Icon = link.icon;
                  const active = isActivePath(currentPath, link.href);

                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      className={active ? 'active' : ''}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon aria-hidden="true" />
                      <span>{link.label}</span>
                      <FiChevronRight className="admin-console-nav-arrow" aria-hidden="true" />
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="admin-console-sidebar-footer">
            <a href="/" className="admin-console-public-link">
              <FiGrid aria-hidden="true" />
              <span>
                <strong>Site public</strong>
                <small>Ouvrir ApprentiFR</small>
              </span>
              <FiChevronRight aria-hidden="true" />
            </a>

            <div className="admin-console-scope">
              <FiMapPin aria-hidden="true" />
              <span>
                <strong>Couverture nationale</strong>
                <small>Données et vigilance France</small>
              </span>
            </div>
          </div>
        </aside>

        <div className="admin-console-workspace">
          <header className="admin-console-mobile-header">
            <a className="admin-console-brand" href="/admin">
              <span className="admin-console-logo" aria-hidden="true">AF</span>
              <span className="admin-console-brand-copy">
                <strong>ApprentiFR</strong>
                <small>Administration</small>
              </span>
            </a>
            <a href="/" className="admin-console-mobile-public">Public</a>
          </header>

          <main className="admin-console-main">
            <div className="admin-console-content">{children}</div>
          </main>
        </div>
      </div>
    </AdminAuthGate>
  );
}
