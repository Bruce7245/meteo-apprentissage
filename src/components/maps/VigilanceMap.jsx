import React, { useMemo, useState } from 'react';
import franceDepartments from '@svg-maps/france.departments';
import VigilanceBadge from '../vigilance/VigilanceBadge.jsx';
import { getLevelCss, getLevelLabel } from '../../utils/levelUtils.js';
import {
  buildDepartmentVigilanceLabel,
  normalizeDisplayedVigilanceLevel,
} from '../../utils/vigilanceDisplayUtils.js';
import './VigilanceMap.css';

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function getDepartmentLevel(department, missingLevel) {
  const candidate =
    department?.publishedLevel ||
    department?.level ||
    missingLevel;

  return normalizeDisplayedVigilanceLevel(
    candidate,
    missingLevel
  );
}

function getDepartmentHref(
  mode,
  code,
  departmentHrefBuilder
) {
  if (typeof departmentHrefBuilder === 'function') {
    return departmentHrefBuilder(code);
  }

  if (mode === 'admin-draft') {
    return '/admin/carte-a-publier';
  }

  if (mode === 'admin-published') {
    return '/admin/carte-publiee';
  }

  return '/departement/' + encodeURIComponent(code);
}

export default function VigilanceMap({
  mode = 'public',
  departments = [],
  loading = false,
  error = null,
  latestDate = null,
  contextLabel = '',
  departmentHrefBuilder = null,
  missingLevel = '',
}) {
  const [activeDepartment, setActiveDepartment] = useState(null);
  const effectiveMissingLevel =
    missingLevel ||
    (mode === 'occupation' ? 'insufficient_data' : 'green');

  const title = mode === 'admin-draft'
    ? 'Carte à publier'
    : mode === 'admin-published'
      ? 'Carte publiée'
      : mode === 'occupation'
        ? 'Carte des vigilances métier'
        : 'Carte des vigilances';

  const departmentsByCode = useMemo(() => {
    return new Map(
      departments.map((department) => [
        normalizeCode(department.code || department.departmentCode),
        department,
      ])
    );
  }, [departments]);

  const metropolitanCodes = useMemo(() => {
    return new Set(
      franceDepartments.locations.map((location) => normalizeCode(location.id))
    );
  }, []);

  const overseasDepartments = useMemo(() => {
    return departments.filter((department) => {
      const code = normalizeCode(
        department.code || department.departmentCode
      );

      return code && !metropolitanCodes.has(code);
    });
  }, [departments, metropolitanCodes]);

  const mappedDepartments = useMemo(() => {
    return franceDepartments.locations.map((location) => {
      const code = normalizeCode(location.id);
      const department = departmentsByCode.get(code) || {
        id: code,
        code,
        departmentCode: code,
        name: location.name,
        level: effectiveMissingLevel,
        publishedLevel: effectiveMissingLevel,
      };

      return {
        location,
        department: {
          ...department,
          code,
          departmentCode: code,
          name:
            department.name ||
            department.departmentName ||
            location.name,
        },
      };
    });
  }, [departmentsByCode, effectiveMissingLevel]);

  const publicMode =
    mode === 'public' ||
    mode === 'occupation';

  return (
    <section className="panel map-panel">
      {publicMode ? (
        <div className="map-toolbar">
          <span>
            {latestDate
              ? 'Publication du ' + latestDate
              : 'Dernière publication disponible'}
          </span>
          <span>
            {loading
              ? 'Chargement…'
              : String(departments.length) + ' département(s)'}
          </span>
        </div>
      ) : (
        <div className="section-heading">
          <div>
            <p className="kicker">Carte</p>
            <h2>{title}</h2>

            {latestDate ? (
              <p className="date-line">
                Date publiée : {latestDate}
              </p>
            ) : null}
          </div>

          <span className="soft-pill">
            {loading
              ? 'Chargement'
              : String(departments.length) + ' département(s)'}
          </span>
        </div>
      )}

      {error ? (
        <div className="state-box error-box">
          Impossible de charger la carte publiée : {error}
        </div>
      ) : null}

      {!error && loading ? (
        <div className="state-box">
          Chargement des vigilances publiées...
        </div>
      ) : null}

      {!error && !loading && departments.length === 0 ? (
        <div className="state-box">
          Aucun département disponible pour le moment.
        </div>
      ) : null}

      {!error && !loading && departments.length > 0 ? (
        <>
          <div className="france-map-layout">
            <div className="france-map-canvas">
              <svg
                className="france-vigilance-map"
                viewBox={franceDepartments.viewBox}
                role="img"
                aria-labelledby="france-map-title france-map-description"
              >
                <title id="france-map-title">{title}</title>

                <desc id="france-map-description">
                  Chaque département est identifié par un niveau de vigilance,
                  également annoncé en texte.
                </desc>

                {mappedDepartments.map(({ location, department }) => {
                  const level = getDepartmentLevel(
                    department,
                    effectiveMissingLevel
                  );
                  const levelCss = getLevelCss(level);
                  const href = getDepartmentHref(
                    mode,
                    department.code,
                    departmentHrefBuilder
                  );
                  const label = buildDepartmentVigilanceLabel({
                    departmentName: department.name,
                    departmentCode: department.code,
                    level,
                    contextLabel,
                  });

                  return (
                    <a
                      key={location.id}
                      href={href}
                      aria-label={label}
                      onMouseEnter={() => setActiveDepartment(department)}
                      onMouseLeave={() => setActiveDepartment(null)}
                      onFocus={() => setActiveDepartment(department)}
                      onBlur={() => setActiveDepartment(null)}
                    >
                      <path
                        id={'department-' + department.code}
                        className={
                          'france-map-path france-map-' + levelCss
                        }
                        d={location.path}
                      >
                        <title>{label}</title>
                      </path>
                    </a>
                  );
                })}
              </svg>
            </div>

            <aside
              className="map-inspector"
              aria-live="polite"
            >
              {activeDepartment ? (
                <>
                  <p className="kicker">Département sélectionné</p>

                  <strong className="map-inspector-title">
                    {activeDepartment.code} · {activeDepartment.name}
                  </strong>

                  {contextLabel ? (
                    <p>{contextLabel}</p>
                  ) : null}

                  <VigilanceBadge
                    level={getDepartmentLevel(
                      activeDepartment,
                      effectiveMissingLevel
                    )}
                  />

                  <p>
                    {activeDepartment.publicSummary ||
                      (mode === 'occupation'
                        ? 'Ouvrez le département pour consulter les indicateurs de ce métier.'
                        : 'Cliquez sur le département pour consulter le bulletin détaillé.')}
                  </p>

                  {publicMode ? (
                    <a
                      className="button-link map-inspector-link"
                      href={getDepartmentHref(
                        mode,
                        activeDepartment.code,
                        departmentHrefBuilder
                      )}
                    >
                      {mode === 'occupation'
                        ? 'Consulter le détail métier'
                        : 'Consulter le bulletin'}
                    </a>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="kicker">Navigation</p>

                  <strong className="map-inspector-title">
                    Survolez un département
                  </strong>

                  <p>
                    {mode === 'occupation'
                      ? 'Le niveau textuel accompagne toujours la couleur. Les zones grises correspondent à des données insuffisantes.'
                      : 'La couleur indique le niveau de vigilance publié. Cliquez sur un département pour ouvrir son bulletin.'}
                  </p>
                </>
              )}
            </aside>
          </div>

          {overseasDepartments.length > 0 ? (
            <section className="overseas-section">
              <div className="overseas-heading">
                <div>
                  <p className="kicker">Outre-mer</p>
                  <h3>Départements et territoires ultramarins</h3>
                </div>

                <span className="soft-pill">
                  {overseasDepartments.length}
                </span>
              </div>

              <div className="overseas-grid">
                {overseasDepartments.map((department) => {
                  const code = normalizeCode(
                    department.code || department.departmentCode
                  );
                  const level = getDepartmentLevel(
                    department,
                    effectiveMissingLevel
                  );

                  return (
                    <a
                      key={department.id || code}
                      className="overseas-card"
                      href={getDepartmentHref(
                        mode,
                        code,
                        departmentHrefBuilder
                      )}
                      aria-label={buildDepartmentVigilanceLabel({
                        departmentName:
                          department.name ||
                          department.departmentName,
                        departmentCode: code,
                        level,
                        contextLabel,
                      })}
                    >
                      <span>
                        <strong>{code}</strong>
                        <small>
                          {department.name ||
                            department.departmentName}
                        </small>
                      </span>

                      <VigilanceBadge level={level} />
                    </a>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
