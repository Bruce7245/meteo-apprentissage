import React from 'react';

export default function JobsFormationsSwitcher({ active }) {
  return (
    <nav className="jobs-formations-switcher" aria-label="Explorer les métiers et formations">
      <a
        href="/metiers"
        className={
          active === 'metiers'
            ? 'jobs-formations-switcher-link is-active'
            : 'jobs-formations-switcher-link'
        }
        aria-current={active === 'metiers' ? 'page' : undefined}
      >
        <span>Métiers</span>
        <small>ROME, secteurs et vigilance territoriale</small>
      </a>

      <a
        href="/formations"
        className={
          active === 'formations'
            ? 'jobs-formations-switcher-link is-active'
            : 'jobs-formations-switcher-link'
        }
        aria-current={active === 'formations' ? 'page' : undefined}
      >
        <span>Formations</span>
        <small>Offre de formation et sessions disponibles</small>
      </a>
    </nav>
  );
}
