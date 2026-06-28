import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from './firebase';
import AdminChartsPanel from './AdminChartsPanel';

const tabs = [
  { id: 'overview', label: 'Vue d’ensemble' },
  { id: 'charts', label: 'Tendances' },
  { id: 'departments', label: 'Départements' },
  { id: 'sectors', label: 'Secteurs' },
  { id: 'quality', label: 'Qualité des données' },
  { id: 'logs', label: 'Imports' },
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString('fr-FR');
}

function formatDate(value) {
  if (!value) {
    return 'Non disponible';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value?.toDate) {
    return value.toDate().toLocaleString('fr-FR');
  }

  return String(value);
}

function topLabel(items, key = 'sector') {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Non renseigné';
  }

  const first = items[0];
  return first[key] || first.label || first.code || 'Non renseigné';
}

function sumBy(items, field) {
  return items.reduce((total, item) => total + Number(item?.[field] || 0), 0);
}

function collectTopSectors(departmentStats) {
  const counter = {};

  departmentStats.forEach((department) => {
    const sectors = Array.isArray(department.topRomeFamilies)
      ? department.topRomeFamilies
      : [];

    sectors.forEach((sector) => {
      const label = sector.sector || sector.label || 'Inconnu';
      counter[label] = (counter[label] || 0) + Number(sector.count || 0);
    });
  });

  return Object.entries(counter)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function collectTopNaf(departmentStats) {
  const counter = {};

  departmentStats.forEach((department) => {
    const sectors = Array.isArray(department.topNafLabels)
      ? department.topNafLabels
      : [];

    sectors.forEach((sector) => {
      const label = sector.label || 'Inconnu';
      counter[label] = (counter[label] || 0) + Number(sector.count || 0);
    });
  });

  return Object.entries(counter)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function getLatestDate(dailyStats) {
  const dates = dailyStats
    .map((item) => item.date)
    .filter(Boolean)
    .sort();

  return dates.length > 0 ? dates[dates.length - 1] : '';
}

function buildAnalysis(departmentStats, latestDailyStats, topSectors) {
  const messages = [];

  const lowVolumeDepartments = [...departmentStats]
    .sort((a, b) => Number(a.jobsCount || 0) - Number(b.jobsCount || 0))
    .slice(0, 8);

  const cappedDepartments = departmentStats.filter((department) => {
    return Number(department.jobsCount || 0) >= 445 || Number(department.returnedActiveJobsCount || 0) >= 445;
  });

  const strongOpeningRatio = departmentStats
    .map((department) => {
      const jobs = Number(department.jobsCount || 0);
      const openings = Number(department.openingCount || 0);

      return {
        ...department,
        openingRatio: jobs > 0 ? openings / jobs : 0,
      };
    })
    .filter((department) => department.openingRatio >= 1.15)
    .sort((a, b) => b.openingRatio - a.openingRatio)
    .slice(0, 8);

  if (lowVolumeDepartments.length > 0) {
    messages.push({
      title: 'Départements à faible volume observé',
      text: lowVolumeDepartments
        .map((department) => `${department.name} (${department.code}) : ${formatNumber(department.jobsCount)} offres`)
        .join(' • '),
    });
  }

  if (cappedDepartments.length > 0) {
    messages.push({
      title: 'Départements probablement plafonnés par l’API',
      text: cappedDepartments
        .slice(0, 10)
        .map((department) => `${department.name} (${department.code})`)
        .join(' • '),
    });
  }

  if (strongOpeningRatio.length > 0) {
    messages.push({
      title: 'Départements avec plusieurs postes par offre',
      text: strongOpeningRatio
        .map((department) => {
          return `${department.name} (${department.code}) : ${department.openingRatio.toFixed(2)} poste/offre`;
        })
        .join(' • '),
    });
  }

  if (latestDailyStats.length > 0) {
    const todayJobs = sumBy(latestDailyStats, 'jobsCount');
    const todayOpenings = sumBy(latestDailyStats, 'openingCount');
    const notSeen = sumBy(latestDailyStats, 'notSeenSinceYesterdayCount');

    messages.push({
      title: 'Lecture quotidienne',
      text: `${formatNumber(todayJobs)} offres créées sur la dernière journée disponible, ${formatNumber(todayOpenings)} postes associés, ${formatNumber(notSeen)} offres non retrouvées depuis la veille.`,
    });
  }

  if (topSectors.length > 0) {
    messages.push({
      title: 'Secteurs dominants',
      text: topSectors
        .slice(0, 5)
        .map((sector) => `${sector.label} : ${formatNumber(sector.count)}`)
        .join(' • '),
    });
  }

  return messages;
}

function AdminStatsDashboard() {
  const [activeTab, setActiveTab] = useState('charts');
  const [departmentStats, setDepartmentStats] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [apiImports, setApiImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      setErrorMessage('');

      try {
        const departmentSnapshot = await getDocs(collection(db, 'departmentStats'));

        let dailySnapshot;
        let importsSnapshot;

        try {
          dailySnapshot = await getDocs(
            query(
              collection(db, 'departmentDailyStats'),
              orderBy('importedAt', 'desc'),
              limit(300)
            )
          );
        } catch (error) {
          console.warn('Aucune donnée quotidienne lisible pour le moment.', error);
          dailySnapshot = { docs: [] };
        }

        try {
          importsSnapshot = await getDocs(
            query(
              collection(db, 'apiImports'),
              orderBy('finishedAt', 'desc'),
              limit(30)
            )
          );
        } catch (error) {
          console.warn('Aucun journal d’import lisible pour le moment.', error);
          importsSnapshot = { docs: [] };
        }

        setDepartmentStats(
          departmentSnapshot.docs
            .map((document) => ({
              id: document.id,
              ...document.data(),
            }))
            .filter((item) => !item.lastError)
            .sort((a, b) => String(a.code).localeCompare(String(b.code)))
        );

        setDailyStats(
          dailySnapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }))
        );

        setApiImports(
          importsSnapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }))
        );
      } catch (error) {
        console.error('Erreur chargement tableau de bord admin :', error);
        setErrorMessage('Impossible de charger les statistiques admin.');
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, []);

  const computed = useMemo(() => {
    const latestDailyDate = getLatestDate(dailyStats);
    const latestDailyStats = latestDailyDate
      ? dailyStats.filter((item) => item.date === latestDailyDate)
      : [];

    const topDepartments = [...departmentStats]
      .sort((a, b) => Number(b.jobsCount || 0) - Number(a.jobsCount || 0))
      .slice(0, 10);

    const lowDepartments = [...departmentStats]
      .sort((a, b) => Number(a.jobsCount || 0) - Number(b.jobsCount || 0))
      .slice(0, 10);

    const topSectors = collectTopSectors(departmentStats);
    const topNaf = collectTopNaf(departmentStats);

    return {
      latestDailyDate,
      latestDailyStats,
      topDepartments,
      lowDepartments,
      topSectors,
      topNaf,
      analysis: buildAnalysis(departmentStats, latestDailyStats, topSectors),
      totals: {
        jobs30: sumBy(departmentStats, 'jobsCount'),
        openings30: sumBy(departmentStats, 'openingCount'),
        recruiters: sumBy(departmentStats, 'recruitersCount'),
        returnedActiveJobs: sumBy(departmentStats, 'returnedActiveJobsCount'),
        todayJobs: sumBy(latestDailyStats, 'jobsCount'),
        todayOpenings: sumBy(latestDailyStats, 'openingCount'),
        expiringSoon: sumBy(latestDailyStats, 'expiringSoonCount'),
        notSeen: sumBy(latestDailyStats, 'notSeenSinceYesterdayCount'),
      },
    };
  }, [departmentStats, dailyStats]);

  return (
    <section className="admin-stats-dashboard">
      <div className="admin-section-heading">
        <p className="admin-kicker">Observatoire</p>
        <h2>Observatoire des données</h2>
        <p>
          Vue consolidée des données observées : contexte sur 30 jours, flux du dernier jour, secteurs, départements et limites de lecture.
        </p>
      </div>

      <div className="admin-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p>Chargement des statistiques...</p>}
      {errorMessage && <p className="admin-error">{errorMessage}</p>}

      {!loading && activeTab === 'charts' && (
        <AdminChartsPanel />
      )}

      {!loading && activeTab === 'overview' && (
        <div className="stats-panel">
          <div className="stats-block-heading">
            <div>
              <p className="admin-eyebrow">Contexte</p>
              <h3>Observation sur 30 jours</h3>
            </div>
            <p>Ces indicateurs décrivent le volume observé sur la période récente. Ils donnent le contexte, pas le mouvement quotidien.</p>
          </div>

          <div className="stats-card-grid">
            <article className="stats-card">
              <span>Offres observées sur 30 jours</span>
              <strong>{formatNumber(computed.totals.jobs30)}</strong>
            </article>
            <article className="stats-card">
              <span>Postes observés sur 30 jours</span>
              <strong>{formatNumber(computed.totals.openings30)}</strong>
            </article>
            <article className="stats-card">
              <span>Recruteurs observés</span>
              <strong>{formatNumber(computed.totals.recruiters)}</strong>
            </article>
            <article className="stats-card">
              <span>Offres actives retournées</span>
              <strong>{formatNumber(computed.totals.returnedActiveJobs)}</strong>
            </article>
          </div>

          <div className="stats-block-heading">
            <div>
              <p className="admin-eyebrow">Flux</p>
              <h3>Dernière journée disponible</h3>
            </div>
            <p>Ces indicateurs décrivent le flux du dernier jour importé. Ils servent à lire le mouvement récent.</p>
          </div>

          <div className="stats-card-grid">
            <article className="stats-card">
              <span>Date du flux</span>
              <strong>{computed.latestDailyDate || 'Aucune'}</strong>
            </article>
            <article className="stats-card">
              <span>Offres créées dernier jour</span>
              <strong>{formatNumber(computed.totals.todayJobs)}</strong>
            </article>
            <article className="stats-card">
              <span>Postes créés dernier jour</span>
              <strong>{formatNumber(computed.totals.todayOpenings)}</strong>
            </article>
            <article className="stats-card">
              <span>Non retrouvées depuis hier</span>
              <strong>{formatNumber(computed.totals.notSeen)}</strong>
            </article>
          </div>

          <div className="stats-two-columns">
            <div className="stats-table-card">
              <h3>Territoires avec volume élevé observé</h3>
              <table>
                <thead>
                  <tr>
                    <th>Département</th>
                    <th>Offres</th>
                    <th>Postes</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.topDepartments.map((department) => (
                    <tr key={department.code}>
                      <td>{department.name} ({department.code})</td>
                      <td>{formatNumber(department.jobsCount)}</td>
                      <td>{formatNumber(department.openingCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="stats-table-card">
              <h3>Territoires à faible volume observé</h3>
              <table>
                <thead>
                  <tr>
                    <th>Département</th>
                    <th>Offres</th>
                    <th>Secteur dominant</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.lowDepartments.map((department) => (
                    <tr key={department.code}>
                      <td>{department.name} ({department.code})</td>
                      <td>{formatNumber(department.jobsCount)}</td>
                      <td>{topLabel(department.topRomeFamilies)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === 'departments' && (
        <div className="stats-table-card">
          <h3>Lecture territoriale du critère saturation</h3>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Département</th>
                <th>Offres observées 30 jours</th>
                <th>Postes</th>
                <th>Recruteurs</th>
                <th>Secteur dominant</th>
              </tr>
            </thead>
            <tbody>
              {departmentStats.map((department) => (
                <tr key={department.code}>
                  <td>{department.code}</td>
                  <td>{department.name}</td>
                  <td>{formatNumber(department.jobsCount)}</td>
                  <td>{formatNumber(department.openingCount)}</td>
                  <td>{formatNumber(department.recruitersCount)}</td>
                  <td>{topLabel(department.topRomeFamilies)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === 'sectors' && (
        <div className="stats-two-columns">
          <div className="stats-table-card">
            <h3>Familles métiers exposées</h3>
            <table>
              <thead>
                <tr>
                  <th>Secteur</th>
                  <th>Occurrences</th>
                </tr>
              </thead>
              <tbody>
                {computed.topSectors.slice(0, 20).map((sector) => (
                  <tr key={sector.label}>
                    <td>{sector.label}</td>
                    <td>{formatNumber(sector.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stats-table-card">
            <h3>Activités NAF exposées</h3>
            <table>
              <thead>
                <tr>
                  <th>NAF</th>
                  <th>Occurrences</th>
                </tr>
              </thead>
              <tbody>
                {computed.topNaf.slice(0, 20).map((sector) => (
                  <tr key={sector.label}>
                    <td>{sector.label}</td>
                    <td>{formatNumber(sector.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && activeTab === 'logs' && (
        <div className="stats-panel">
          <div className="stats-block-heading">
            <div>
              <p className="admin-eyebrow">Technique</p>
              <h3>Imports et traitements</h3>
            </div>
            <p>Cette section sert à contrôler les exécutions techniques : imports API, rapports IA et erreurs éventuelles.</p>
          </div>

          <div className="stats-table-card">
            <h3>Journaux d’import</h3>
            <table>
              <thead>
                <tr>
                  <th>Import</th>
                  <th>Type</th>
                  <th>Date / période</th>
                  <th>Succès</th>
                  <th>Erreurs</th>
                  <th>Fin</th>
                </tr>
              </thead>
              <tbody>
                {apiImports.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.type || 'Non renseigné'}</td>
                    <td>{item.date || `${item.periodStart || '?'} → ${item.periodEnd || '?'}`}</td>
                    <td>{formatNumber(item.successCount)}</td>
                    <td>{formatNumber(item.errorCount)}</td>
                    <td>{formatDate(item.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {apiImports.length === 0 && (
              <p className="empty-state">Aucun journal d’import disponible.</p>
            )}
          </div>
        </div>
      )}

      {!loading && activeTab === 'quality' && (
        <div className="analysis-grid">
          {computed.analysis.map((item) => (
            <article className="analysis-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}

          <article className="analysis-card warning">
            <h3>Limite de lecture</h3>
            <p>
              Cette lecture signale les points de prudence : faibles volumes, résultats probablement plafonnés, ratios inhabituels ou données quotidiennes incomplètes. Elle aide au diagnostic mais ne décide pas d’un niveau de vigilance.
            </p>
          </article>
        </div>
      )}
    </section>
  );
}

export default AdminStatsDashboard;
