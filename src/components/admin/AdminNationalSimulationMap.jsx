import React, {useEffect, useMemo, useRef, useState} from 'react';
import franceDepartments from '@svg-maps/france.departments';
import {FiInfo, FiRefreshCw, FiShield, FiTarget} from 'react-icons/fi';
import {getAdminMonthlySettings} from '../../services/adminMonthlySettingsService.js';
import {
  ADMIN_SIMULATION_BANDS,
  ADMIN_SIMULATION_BAND_LEGEND,
} from '../../utils/adminSimulationColors.mjs';
import {DEPARTMENT_CODES} from '../../utils/departmentUtils.js';
import {
  buildAdminNationalSimulationMap,
  OVERSEAS_CODES,
} from '../../utils/adminNationalSimulationMap.mjs';
import AdminSimulationColorBadge from './AdminSimulationColorBadge.jsx';
import './AdminNationalSimulationMap.css';

const decimal = new Intl.NumberFormat('fr-FR', {maximumFractionDigits:2});
const precise = new Intl.NumberFormat('fr-FR', {maximumFractionDigits:3});
const percent = new Intl.NumberFormat('fr-FR', {
  style:'percent',maximumFractionDigits:1,
});
const QUALITIES = {
  experimental:'Expérimental',
  provisional:'Provisoire',
  indicative:'Indicatif',
  partial:'Partiel',
  unavailable:'Indisponible',
};
const COLORS = [...ADMIN_SIMULATION_BANDS,
  {key:'unknown',label:'Gris',meaning:'Données insuffisantes'}];

function formatNumber(value, formatter = decimal) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatter.format(value) : '—';
}

function formatChange(value) {
  if (typeof value?.value !== 'number' || !Number.isFinite(value.value)) return '—';
  return (value.quality === 'indicative' ? '≈ ' : '') +
    (value.value > 0 ? '+' : '') + percent.format(value.value);
}

function formatSmallRate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.001) return '< 0,001';
  return precise.format(value);
}

function scoreLabel(department) {
  const score = department?.score;
  if (typeof score === 'number' && Number.isFinite(score)) {
    return formatNumber(score) + ' / 100';
  }
  if (department?.basis === 'density_only') {
    return formatNumber(department.index) + ' / 100 (densité seule)';
  }
  return 'Indisponible';
}

function MapMetric({label,value,description}) {
  return (
    <div className="admin-nmap-inspector-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {description && <small>{description}</small>}
    </div>
  );
}

function NationalMapInspector({department,model}) {
  if (!department) {
    return (
      <div className="admin-nmap-inspector-placeholder">
        <FiTarget aria-hidden="true" />
        <strong>Explorer les résultats</strong>
        <p>Sélectionne un département sur la carte ou dans la liste pour consulter
          les indicateurs ayant conduit à sa couleur simulée.</p>
      </div>
    );
  }

  const quality = QUALITIES[department.scoreQuality] || 'Non vérifié';
  const provisional = model.isProvisional;
  const normalized = department.scoreRecord?.components || {};
  const hasObservations = typeof department.daysObserved === 'number';
  const coverage = hasObservations
    ? department.daysObserved + ' / ' + department.daysExpected + ' jours relevés'
    : 'Couverture inconnue';

  return (
    <>
      <div className="admin-nmap-inspector-head">
        <div>
          <span className="admin-nmap-kicker">Département {department.code}</span>
          <h3>{department.name}</h3>
        </div>
        <AdminSimulationColorBadge score={department.scoreRecord} compact />
      </div>

      <div className="admin-nmap-inspector-score">
        <span>
          {department.basis === 'density_only'
            ? 'Indice de densité uniquement'
            : 'Indice pondéré simulé'}
        </span>
        <strong>{scoreLabel(department)}</strong>
        <small>{quality} · {department.color.detail}</small>
      </div>

      <div className="admin-nmap-inspector-coverage">
        <strong>Qualité de l'observation</strong>
        <span>{coverage}</span>
        {provisional && (
          <small>Le score provisoire utilise uniquement les journées communes
            précisées dans le bandeau national. La moyenne brute du mois
            ci-dessous peut reposer sur un ensemble de jours différent.</small>
        )}
      </div>

      <div className="admin-nmap-inspector-metrics">
        <MapMetric label="Offres actives moyennes observées" value={formatNumber(department.averageOffers)}
          description={provisional ? 'Moyenne du mois sur jours disponibles, pas nécessairement la base du score provisoire' : 'Moyenne du mois analysé'} />
        <MapMetric label="Offres pour 10 000 jeunes" value={formatSmallRate(department.density)}
          description="Densité descriptive issue des jours du mois relevés" />
        <MapMetric label="Établissements employeurs" value={formatNumber(department.employers)}
          description="Tous secteurs économiques" />
        <MapMetric label="Offres pour 100 employeurs" value={formatSmallRate(department.offersPer100Employers)}
          description="Rapport, pas pourcentage d'employeurs recrutant" />
        <MapMetric label="Indice densité /100" value={formatNumber(normalized.density)}
          description="Composante comparée à la référence nationale" />
        <MapMetric label="Indice potentiel employeur /100" value={formatNumber(normalized.employers)}
          description="Composante normalisée" />
        <MapMetric label="Indice intensité employeur /100" value={formatNumber(normalized.employerIntensity)}
          description="Composante normalisée" />
        <MapMetric label="Indice évolution /100" value={formatNumber(normalized.trend)}
          description="Uniquement lorsque les comparaisons sont valides" />
        <MapMetric label="Évolution M−1" value={formatChange(department.changeMonth)} />
        <MapMetric label="Évolution M−12" value={formatChange(department.changeYear)} />
      </div>
    </>
  );
}

export default function AdminNationalSimulationMap({month,onMonthChange}) {
  const [payload,setPayload] = useState(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [selectedCode,setSelectedCode] = useState('');
  const [hoveredCode,setHoveredCode] = useState('');
  const [tableFilter,setTableFilter] = useState('all');
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setPayload(null);
    setError('');
    setLoading(false);
    setSelectedCode('');
    setHoveredCode('');
    setTableFilter('all');
  },[month]);

  const model = useMemo(() => buildAdminNationalSimulationMap(
    payload?.month === month ? payload : null,
  ),[payload,month]);
  const activeCode = hoveredCode || selectedCode;
  const activeDepartment = model.byCode.get(activeCode) || null;
  const previewBasis = model.previewBasis;
  const unavailableReason = previewBasis?.reason === 'NO_SHARED_REFERENCE_WINDOW'
    ? previewBasis.explanation
    : null;

  const visibleRows = useMemo(() => model.departments.filter(department =>
    tableFilter === 'all' || department.color.key === tableFilter),
  [model,tableFilter]);

  async function simulate() {
    if (!month || loading) return;
    const ticket = ++generation.current;
    setLoading(true);
    setError('');
    setPayload(null);
    setHoveredCode('');
    try {
      // Intentionally no ROME or focused department: a genuinely national,
      // all-occupation reference, unlike the individual profession cards below.
      const response = await getAdminMonthlySettings(month);
      if (response?.scope !== 'all_offers_department') {
        throw new Error('Périmètre inattendu : la carte exige tous les métiers.');
      }
      if (ticket !== generation.current) return;
      setPayload(response);
    } catch (caught) {
      if (ticket !== generation.current) return;
      setError(caught?.message || 'Simulation nationale indisponible.');
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }

  const colorCounts = model.summary;
  const statusNote = !model.available
    ? 'La carte reste grise tant que la simulation n’a pas été lancée.'
    : colorCounts.colored === 0
      ? 'Aucune couleur calculable sur ce mois : les données ou la référence nationale sont insuffisantes.'
      : colorCounts.colored + ' départements colorés sur 101, ' +
        colorCounts.unknown + ' sans indice calculable.';

  return (
    <section className="panel admin-nmap-panel" aria-labelledby="admin-nmap-title">
      <header className="admin-nmap-header">
        <div>
          <p className="admin-nmap-kicker">Administration · Nouveau moteur expérimental</p>
          <h2 id="admin-nmap-title">Carte nationale simulée</h2>
          <p>101 départements · Tous les métiers · Référence nationale du nouveau modèle.
            Aucune incidence sur la carte publiée.</p>
        </div>
        <span className="admin-nmap-label">Simulation non publiée</span>
      </header>

      <div className="admin-nmap-controls">
        <label htmlFor="admin-nmap-month">Mois analysé
          <input id="admin-nmap-month" type="month" value={month}
            max={new Intl.DateTimeFormat('fr-CA',{
              timeZone:'Europe/Paris',year:'numeric',month:'2-digit',
            }).format(new Date())}
            onChange={event => {
              if (event.target.value) onMonthChange(event.target.value);
            }}
          />
        </label>
        <div className="admin-nmap-scope">
          <small>Périmètre statistique</small>
          <strong>Tous les métiers · France entière</strong>
        </div>
        <button type="button" className="primary-button admin-nmap-run"
          onClick={simulate} disabled={loading}>
          <FiRefreshCw aria-hidden="true" />
          {loading ? 'Calcul en cours…' :
            model.available ? 'Actualiser la carte' : 'Simuler la carte nationale'}
        </button>
      </div>

      {loading && <p className="admin-nmap-message" role="status">
        Analyse des relevés disponibles et de la référence nationale…
      </p>}
      {error && <p className="admin-nmap-message admin-nmap-message--error" role="alert">
        {error} La carte ne reçoit aucune couleur par défaut.
      </p>}

      <div className="admin-nmap-reliability">
        <FiShield aria-hidden="true"/>
        <div>
          <strong>{model.available
            ? model.isProvisional ? 'Lecture provisoire sur jours comparables' : 'Lecture mensuelle expérimentale'
            : 'Carte préparée : aucune simulation lancée'}</strong>
          <p>{model.available && model.isProvisional && previewBasis?.sharedDays?.length
            ? previewBasis.sharedDays.length + ' journées communes, du ' +
                previewBasis.firstDate + ' au ' + previewBasis.lastDate + ' · ' +
                previewBasis.referenceDepartments + ' départements de référence · ' +
                (previewBasis.method || 'Méthode non précisée') + '.'
            : model.available
              ? 'Mois ' + model.month + '. Référence nationale : ' +
                (model.reference?.eligibleDepartments ?? 0) +
                ' départements éligibles ; méthode expérimentale.'
              : 'Choisis un mois puis lance le calcul. Les départements sont gris en attendant.'}
          </p>
          {unavailableReason && <p className="admin-nmap-reliability-warning">{unavailableReason}</p>}
          <small>{model.available && model.isProvisional
            ? 'Les M−1 et M−12 restent indisponibles si leurs mois sont incomplets.'
            : 'Le score dépend de la couverture et des références INSEE disponibles.'}
          </small>
        </div>
      </div>

      <div className="admin-nmap-summary" aria-label="Répartition des couleurs expérimentales">
        {COLORS.map(color => (
          <div className={'admin-nmap-summary-item admin-nmap-summary--' + color.key}
            key={color.key}>
            <span><span className="admin-nmap-summary-dot" aria-hidden="true"/>
              {color.label}</span>
            <strong>{model.available ? colorCounts[color.key] : '—'}</strong>
            <small>{color.meaning}</small>
          </div>
        ))}
      </div>

      <div className="admin-nmap-legend" aria-label="Seuils provisoires de la simulation">
        <p><FiInfo aria-hidden="true"/> <strong>Lecture des couleurs :</strong> {ADMIN_SIMULATION_BAND_LEGEND}</p>
        <p><strong>Gris :</strong> pas de résultat défendable. Une couleur « densité seule »
          ne signifie pas qu'un score pondéré complet existe. Un indice plus élevé
          indique une situation relativement plus favorable, pas une probabilité d'obtenir un contrat.</p>
      </div>

      <div className="admin-nmap-layout">
        <div className="admin-nmap-map-container">
          <svg className="admin-nmap-svg" viewBox={franceDepartments.viewBox}
            role="group" aria-label="Carte de France interactive des indices départementaux simulés">
            <title>Carte nationale simulée de l'apprentissage — nouvelle méthode</title>
            <desc>Les départements sans indice disponible sont gris.
              Sélectionne un département pour connaître sa couleur et ses indicateurs.</desc>
            {franceDepartments.locations.map(location => {
              const code = String(location.id).toUpperCase();
              const department = model.byCode.get(code);
              const key = department?.color.key || 'unknown';
              const label = (department?.name || location.name) + ' (' + code + ') : ' +
                (department?.color.label || 'Indéterminé') + ', ' +
                (department ? scoreLabel(department) : 'non calculé') +
                ' — simulation uniquement';
              return (
                <a key={code} href="#admin-nmap-inspector" aria-label={label}
                  aria-current={selectedCode === code ? 'true' : undefined}
                  onClick={event => {
                    event.preventDefault();
                    setSelectedCode(code);
                    setHoveredCode('');
                  }}
                  onFocus={() => setHoveredCode(code)}
                  onBlur={() => setHoveredCode('')}
                  onMouseEnter={() => setHoveredCode(code)}
                  onMouseLeave={() => setHoveredCode('')}>
                  <path d={location.path}
                    className={'admin-nmap-path admin-nmap-path--' + key +
                      (selectedCode === code ? ' admin-nmap-path--selected' : '')}>
                    <title>{label}</title>
                  </path>
                </a>
              );
            })}
          </svg>
          <p className="admin-nmap-map-caption">{statusNote}</p>

          <div className="admin-nmap-overseas" aria-label="Départements d'outre-mer">
            <h3>Outre-mer</h3>
            <div>
              {OVERSEAS_CODES.map(code => {
                const department = model.byCode.get(code);
                return (
                  <button type="button" key={code}
                    className={'admin-nmap-overseas-button' +
                      (selectedCode === code ? ' admin-nmap-overseas-button--selected' : '')}
                    onClick={() => {setSelectedCode(code);setHoveredCode('');}}>
                    <span>{code} · {department?.name}</span>
                    <AdminSimulationColorBadge score={department?.scoreRecord} compact />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="admin-nmap-inspector" id="admin-nmap-inspector" aria-live="polite">
          <label htmlFor="admin-nmap-department">Département à examiner
            <select id="admin-nmap-department" value={selectedCode}
              onChange={event => {
                setSelectedCode(event.target.value);
                setHoveredCode('');
              }}>
              <option value="">Sélectionner</option>
              {DEPARTMENT_CODES.map(code => {
                const department = model.byCode.get(code);
                return <option key={code} value={code}>
                  {code} — {department?.name}
                </option>;
              })}
            </select>
          </label>
          <NationalMapInspector department={activeDepartment} model={model} />
        </aside>
      </div>

      <details className="admin-nmap-details">
        <summary>Afficher les 101 départements et les scores simulés</summary>
        <div className="admin-nmap-table-filter">
          <label htmlFor="admin-nmap-filter">Filtrer la liste
            <select id="admin-nmap-filter" value={tableFilter}
              onChange={event => setTableFilter(event.target.value)}>
              <option value="all">Tous les départements</option>
              {COLORS.map(color => (
                <option key={color.key} value={color.key}>{color.label}</option>
              ))}
            </select>
          </label>
          <span>{visibleRows.length} / 101 départements</span>
        </div>
        <div className="admin-nmap-table-scroll" role="region"
          aria-label="Tableau des couleurs et scores nationaux simulés" tabIndex={0}>
          <table className="simple-table admin-nmap-table">
            <thead>
              <tr>
                <th scope="col">Département</th>
                <th scope="col">Couleur simulée</th>
                <th scope="col">Score ou indice</th>
                <th scope="col">Qualité</th>
                <th scope="col">Jours relevés</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(department => (
                <tr key={department.code}>
                  <th scope="row">
                    <button type="button" className="admin-nmap-table-choose"
                      onClick={() => {
                        setSelectedCode(department.code);
                        setHoveredCode('');
                      }}>
                      {department.code} · {department.name}
                    </button>
                  </th>
                  <td><AdminSimulationColorBadge
                    score={department.scoreRecord} compact /></td>
                  <td>{scoreLabel(department)}</td>
                  <td>{QUALITIES[department.scoreQuality] || 'Indisponible'}</td>
                  <td>{department.daysObserved === null ? '—' :
                    department.daysObserved + ' / ' + department.daysExpected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="admin-nmap-disclaimer">
        <strong>Simulation interne.</strong> La carte représente une estimation
        statistique susceptible d'évoluer avec la collecte, la complétude des
        dénominateurs et la calibration des seuils. Les coefficients actuels
        viennent du brouillon Admin ; le correcteur saisonnier reste neutre
        à 1,00. Ni l'accueil, ni la carte publique, ni les vigilances officielles
        ne sont modifiés.
      </p>
    </section>
  );
}
