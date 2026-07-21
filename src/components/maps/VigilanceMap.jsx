import React from 'react';
import VigilanceBadge from '../vigilance/VigilanceBadge.jsx';

export default function VigilanceMap({
  mode = 'public',
  departments = [],
  loading = false,
  error = null,
  latestDate = null,
}) {
  const title = mode === 'admin-draft'
    ? 'Carte à publier'
    : mode === 'admin-published'
      ? 'Carte publiée'
      : 'Carte des vigilances';

  return (
    <section className="panel map-panel">
      <div className="section-heading">
        <div>
          <p className="kicker">Carte</p>
          <h2>{title}</h2>
          {latestDate ? <p className="date-line">Date publiée : {latestDate}</p> : null}
        </div>
        <span className="soft-pill">
          {loading ? 'Chargement' : `${departments.length} département(s)`}
        </span>
      </div>

      {error ? (
        <div className="state-box error-box">
          Impossible de charger la carte publiée : {error}
        </div>
      ) : null}

      {!error && loading ? (
        <div className="state-box">Chargement des vigilances publiées...</div>
      ) : null}

      {!error && !loading && departments.length === 0 ? (
        <div className="state-box">
          Aucune vigilance publiée pour le moment.
        </div>
      ) : null}

      {!error && !loading && departments.length > 0 ? (
        <div className="department-grid">
          {departments.map((department) => {
            const href = mode.startsWith('admin')
              ? `/admin/carte-publiee`
              : `/departement/${department.code}`;

            return (
              <a
                key={department.id || department.code}
                href={href}
                className="department-tile"
              >
                <span>
                  <strong>{department.code}</strong>
                  <small>{department.name}</small>
                </span>
                <VigilanceBadge level={department.level || department.publishedLevel} />
              </a>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
