import React, { useEffect, useMemo, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import JobsFormationsSwitcher from '../../components/JobsFormationsSwitcher.jsx';
import FullscreenSearchDialog from '../../components/FullscreenSearchDialog.jsx';
import DepartmentKpiCard from '../../components/dashboard/DepartmentKpiCard.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';
import { getPublicFormationDepartmentStats } from '../../services/formationPublicService.js';

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('fr-FR').format(number);
}

export default function PublicFormationsPage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDepartmentCode, setSelectedDepartmentCode] = useState('');
  const [formationResult, setFormationResult] = useState(null);
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [loadingFormation, setLoadingFormation] = useState(false);
  const [departmentsError, setDepartmentsError] = useState('');
  const [formationError, setFormationError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadDepartments() {
      try {
        setLoadingDepartments(true);
        setDepartmentsError('');

        const index = await getLatestPublicVigilanceIndex();
        const rows = Array.isArray(index?.departments)
          ? [...index.departments]
          : [];

        rows.sort((a, b) => {
          const nameA = a.name || a.departmentName || a.code || '';
          const nameB = b.name || b.departmentName || b.code || '';
          return nameA.localeCompare(nameB, 'fr');
        });

        if (alive) setDepartments(rows);
      } catch (error) {
        if (alive) {
          setDepartmentsError(
            error?.message ||
              'La liste des départements est momentanément indisponible.'
          );
        }
      } finally {
        if (alive) setLoadingDepartments(false);
      }
    }

    loadDepartments();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadFormationStats() {
      if (!selectedDepartmentCode) {
        setFormationResult(null);
        setFormationError('');
        setLoadingFormation(false);
        return;
      }

      try {
        setLoadingFormation(true);
        setFormationError('');

        const result = await getPublicFormationDepartmentStats(
          selectedDepartmentCode
        );

        if (alive) setFormationResult(result);
      } catch (error) {
        if (alive) {
          setFormationResult(null);
          setFormationError(
            error?.message ||
              'Les données de formation sont momentanément indisponibles.'
          );
        }
      } finally {
        if (alive) setLoadingFormation(false);
      }
    }

    loadFormationStats();

    return () => {
      alive = false;
    };
  }, [selectedDepartmentCode]);

  const selectedDepartment = useMemo(
    () =>
      departments.find((department) => {
        const code = department.code || department.departmentCode;
        return code === selectedDepartmentCode;
      }) || null,
    [departments, selectedDepartmentCode]
  );

  const data = formationResult?.data || null;
  const departmentName =
    selectedDepartment?.name ||
    selectedDepartment?.departmentName ||
    selectedDepartmentCode;

  return (
    <PublicLayout>
      <JobsFormationsSwitcher active="formations" />

      <section className="jobs-formations-workspace">
        <div className="jobs-formations-summary-card">
          <p className="eyebrow">Formations</p>
          <h1>
            {selectedDepartmentCode
              ? 'Formations en apprentissage — ' + departmentName
              : 'Explorer l’offre de formation en apprentissage.'}
          </h1>

          <p className="public-hero-intro">
            Cette vue présente uniquement les données de formation déjà publiées.
            Aucun niveau de vigilance formation n’est affiché tant que ce moteur
            n’est pas validé.
          </p>

          <div className="jobs-formations-primary-actions">
            <button
              type="button"
              className="jobs-formations-search-trigger"
              onClick={() => setSearchOpen(true)}
            >
              <span>Rechercher une formation</span>
              <small>Commencer par un département</small>
            </button>
          </div>
        </div>
      </section>

      <FullscreenSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        eyebrow="Recherche formation"
        title="Choisir un département"
        description="Consultez la couverture de l’offre de formation et les sessions recensées."
      >
        <div className="jobs-formations-dialog-form">
          <label
            className="occupation-search-label"
            htmlFor="formation-department-select"
          >
            Département
          </label>

          <select
            id="formation-department-select"
            className="occupation-domain-select"
            value={selectedDepartmentCode}
            disabled={loadingDepartments}
            onChange={(event) => {
              setSelectedDepartmentCode(event.target.value);
              if (event.target.value) setSearchOpen(false);
            }}
          >
            <option value="">
              {loadingDepartments
                ? 'Chargement des départements…'
                : 'Choisir un département'}
            </option>

            {departments.map((department) => {
              const code =
                department.code || department.departmentCode;
              const name =
                department.name ||
                department.departmentName ||
                code;

              return (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              );
            })}
          </select>

          {departmentsError ? (
            <p className="occupation-search-message is-error" role="alert">
              {departmentsError}
            </p>
          ) : null}

          {!departmentsError ? (
            <p className="occupation-domain-helper">
              La recherche détaillée par intitulé, RNCP et métier ROME sera ajoutée
              dans ce même espace.
            </p>
          ) : null}
        </div>
      </FullscreenSearchDialog>

      {selectedDepartmentCode ? (
        <section className="jobs-formations-results">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Données formations</p>
              <h2>{departmentName}</h2>
            </div>
            <p className="section-note">
              {data?.asOfDate
                ? 'Données agrégées au ' + data.asOfDate + '.'
                : 'Dernières données publiques disponibles.'}
            </p>
          </div>

          {loadingFormation ? (
            <div className="state-box">Chargement des données de formation…</div>
          ) : null}

          {!loadingFormation && formationError ? (
            <div className="state-box error-box" role="alert">
              {formationError}
            </div>
          ) : null}

          {!loadingFormation &&
          !formationError &&
          formationResult &&
          formationResult.exists !== true ? (
            <div className="state-box">
              Aucune donnée de formation publiée pour ce département.
            </div>
          ) : null}

          {!loadingFormation && !formationError && data ? (
            <>
              <div className="department-kpi-grid jobs-formations-kpis">
                <DepartmentKpiCard
                  label="Formations"
                  value={formatNumber(data.formationsCount)}
                  detail="Formations recensées dans le département"
                />
                <DepartmentKpiCard
                  label="Sessions"
                  value={formatNumber(data.sessionsCount)}
                  detail="Sessions rattachées aux formations"
                />
                <DepartmentKpiCard
                  label="Sessions à venir"
                  value={formatNumber(data.upcomingSessionsCount)}
                  detail="Sessions dont le démarrage est à venir"
                />
                <DepartmentKpiCard
                  label="Secteurs couverts"
                  value={formatNumber(data.sectorsCount)}
                  detail="Secteurs représentés dans les données publiées"
                />
              </div>

              <div className="occupation-domain-guidance jobs-formations-guidance">
                <p className="eyebrow">Prochaine étape</p>
                <h2>Relier chaque formation à son contenu et à ses métiers.</h2>
                <p>
                  Le socle est maintenant distinct du parcours Métiers. La prochaine
                  évolution pourra afficher les formations détaillées, les codes RNCP,
                  les sessions, les lieux et les métiers ROME rattachés, puis une
                  vigilance de charge uniquement lorsqu’elle sera méthodologiquement validée.
                </p>
                <a
                  className="button-link"
                  href={'/departement/' + encodeURIComponent(selectedDepartmentCode)}
                >
                  Voir le détail territorial
                </a>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </PublicLayout>
  );
}
