import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { db } from './firebase';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

const CRITERIA = {
  jobsCount: {
    label: 'Offres créées',
    shortLabel: 'Offres',
  },
  openingCount: {
    label: 'Postes à pourvoir',
    shortLabel: 'Postes',
  },
  recruitersCount: {
    label: 'Recruteurs observés',
    shortLabel: 'Recruteurs',
  },
};

const LEVEL_META = {
  Vert: { score: 1, color: '#1f8f55' },
  Jaune: { score: 2, color: '#e7b416' },
  Orange: { score: 3, color: '#f97316' },
  Rouge: { score: 4, color: '#dc2626' },
};

function safeNumber(value) {
  return Number(value || 0);
}

function formatNumber(value) {
  return safeNumber(value).toLocaleString('fr-FR');
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '0 %';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} %`;
}

function percentChange(current, previous) {
  const c = safeNumber(current);
  const p = safeNumber(previous);
  if (!p) return c > 0 ? 100 : 0;
  return ((c - p) / p) * 100;
}

function formatDateLabel(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
  });
}

function isWeekend(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay();
  return day === 0 || day === 6;
}

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function movingAverage(values, windowSize = 7) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1).filter((value) => Number.isFinite(value));
    if (!slice.length) return null;
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function buildForecast(values, horizon = 7) {
  const recent = values.filter((value) => Number.isFinite(value)).slice(-7);
  if (recent.length < 2) {
    return Array.from({ length: horizon }, () => null);
  }

  const slope = (recent[recent.length - 1] - recent[0]) / Math.max(recent.length - 1, 1);
  let current = recent[recent.length - 1];

  return Array.from({ length: horizon }, () => {
    current = Math.max(0, current + slope);
    return Math.round(current * 10) / 10;
  });
}

function normalizeRegion(value) {
  return value || 'Non renseignée';
}

function collectRegions(departments) {
  return [...new Set(departments.map((item) => normalizeRegion(item.region)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function buildDepartmentMetaMap(departmentsRows) {
  return departmentsRows.reduce((accumulator, row) => {
    accumulator[row.code] = {
      code: row.code,
      name: row.name || row.label || `Département ${row.code}`,
      region: normalizeRegion(row.region || row.regionName || row.regionLabel),
    };
    return accumulator;
  }, {});
}

function enrichDailyRows(rows, departmentMetaMap) {
  return rows.map((row) => {
    const code = row.code || row.departmentCode || String(row.id || '').split('_').pop();
    const meta = departmentMetaMap[code] || {};

    return {
      ...row,
      code,
      departmentName: meta.name || row.departmentName || code,
      region: meta.region || 'Non renseignée',
      jobsCount: safeNumber(row.jobsCount),
      openingCount: safeNumber(row.openingCount),
      recruitersCount: safeNumber(row.recruitersCount),
      expiringSoonCount: safeNumber(row.expiringSoonCount),
      notSeenSinceYesterdayCount: safeNumber(row.notSeenSinceYesterdayCount),
    };
  });
}

function enrichStatsRows(rows, departmentMetaMap) {
  return rows.map((row) => {
    const meta = departmentMetaMap[row.code] || {};
    return {
      ...row,
      name: row.name || meta.name || row.code,
      region: meta.region || 'Non renseignée',
      jobsCount: safeNumber(row.jobsCount),
      openingCount: safeNumber(row.openingCount),
      recruitersCount: safeNumber(row.recruitersCount),
    };
  });
}

function aggregateDailySeries(rows, scope, region, departmentCode) {
  const filtered = rows.filter((row) => {
    if (scope === 'region') return row.region === region;
    if (scope === 'department') return row.code === departmentCode;
    return true;
  });

  const grouped = {};
  filtered.forEach((row) => {
    if (!row.date) return;

    if (!grouped[row.date]) {
      grouped[row.date] = {
        date: row.date,
        jobsCount: 0,
        openingCount: 0,
        recruitersCount: 0,
        expiringSoonCount: 0,
        notSeenSinceYesterdayCount: 0,
      };
    }

    grouped[row.date].jobsCount += safeNumber(row.jobsCount);
    grouped[row.date].openingCount += safeNumber(row.openingCount);
    grouped[row.date].recruitersCount += safeNumber(row.recruitersCount);
    grouped[row.date].expiringSoonCount += safeNumber(row.expiringSoonCount);
    grouped[row.date].notSeenSinceYesterdayCount += safeNumber(row.notSeenSinceYesterdayCount);
  });

  return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateRegionsByCurrentStats(statsRows) {
  const grouped = {};
  statsRows.forEach((row) => {
    const region = normalizeRegion(row.region);
    if (!grouped[region]) {
      grouped[region] = {
        label: region,
        jobsCount: 0,
        openingCount: 0,
        recruitersCount: 0,
      };
    }
    grouped[region].jobsCount += safeNumber(row.jobsCount);
    grouped[region].openingCount += safeNumber(row.openingCount);
    grouped[region].recruitersCount += safeNumber(row.recruitersCount);
  });

  return Object.values(grouped).sort((a, b) => b.jobsCount - a.jobsCount);
}

function aggregateDepartments(statsRows, selectedRegion) {
  return statsRows
    .filter((row) => !selectedRegion || row.region === selectedRegion)
    .map((row) => ({
      label: `${row.code} ${row.name}`,
      jobsCount: safeNumber(row.jobsCount),
      openingCount: safeNumber(row.openingCount),
      recruitersCount: safeNumber(row.recruitersCount),
    }))
    .sort((a, b) => b.jobsCount - a.jobsCount)
    .slice(0, 12);
}

function aggregateSectors(statsRows, scope, region, departmentCode) {
  const filtered = statsRows.filter((row) => {
    if (scope === 'region') return row.region === region;
    if (scope === 'department') return row.code === departmentCode;
    return true;
  });

  const grouped = {};

  filtered.forEach((row) => {
    const families = Array.isArray(row.topRomeFamilies) ? row.topRomeFamilies : [];
    families.forEach((family) => {
      const label = family.label || family.sector || family.name || family.code || 'Non classé';
      const count = safeNumber(family.count || family.value || 0);
      grouped[label] = (grouped[label] || 0) + count;
    });
  });

  return Object.entries(grouped)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function computeVigilanceLevels(series, criterion) {
  const values = series.map((row) => safeNumber(row[criterion]));
  const ma7 = movingAverage(values, 7);

  return series.map((row, index) => {
    const current = values[index];
    const previous = index > 0 ? values[index - 1] : current;
    const currentMa7 = ma7[index] ?? current;
    const dailyDelta = percentChange(current, previous);
    const maDelta = percentChange(current, currentMa7);
    const weekend = isWeekend(row.date);

    let level = 'Vert';

    const lowVolumeBase = Math.max(previous, current, currentMa7);

    if (lowVolumeBase < 10) {
      if (dailyDelta <= -60 && !weekend) level = 'Jaune';
      else level = 'Vert';
      return {
        level,
        score: LEVEL_META[level].score,
        color: LEVEL_META[level].color,
        dailyDelta,
        maDelta,
      };
    }

    const repeatedWeakness =
      index >= 2 &&
      values[index] < (ma7[index] ?? values[index]) &&
      values[index - 1] < (ma7[index - 1] ?? values[index - 1]) &&
      values[index - 2] < (ma7[index - 2] ?? values[index - 2]);

    if (
      repeatedWeakness &&
      dailyDelta <= -35 &&
      maDelta <= -30 &&
      !weekend
    ) {
      level = 'Orange';
    } else if (
      (dailyDelta <= -20 || maDelta <= -15) &&
      !(weekend && dailyDelta > -40)
    ) {
      level = 'Jaune';
    }

    if (
      repeatedWeakness &&
      dailyDelta <= -50 &&
      maDelta <= -40 &&
      !weekend &&
      lowVolumeBase >= 35
    ) {
      level = 'Rouge';
    }

    return {
      level,
      score: LEVEL_META[level].score,
      color: LEVEL_META[level].color,
      dailyDelta,
      maDelta,
    };
  });
}

function buildScopeLabel(scope, region, departmentCode, departmentsMetaMap) {
  if (scope === 'region') return region || 'Région';
  if (scope === 'department') {
    const meta = departmentsMetaMap[departmentCode];
    return meta ? `${meta.code} ${meta.name}` : departmentCode || 'Département';
  }
  return 'France entière';
}

function lastDefined(array) {
  const clone = [...array].reverse();
  return clone.find((value) => Number.isFinite(value)) ?? 0;
}

export default function AdminChartsPanel() {
  const [dailyRows, setDailyRows] = useState([]);
  const [statsRows, setStatsRows] = useState([]);
  const [departmentsRows, setDepartmentsRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [scope, setScope] = useState('national');
  const [criterion, setCriterion] = useState('jobsCount');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedSector, setSelectedSector] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        setLoading(true);
        setErrorMessage('');

        const [dailySnapshot, statsSnapshot, departmentsSnapshot] = await Promise.all([
          getDocs(
            query(
              collection(db, 'departmentDailyStats'),
              orderBy('date', 'desc'),
              limit(8000)
            )
          ),
          getDocs(collection(db, 'departmentStats')),
          getDocs(collection(db, 'departments')),
        ]);

        if (!mounted) return;

        const loadedDepartments = departmentsSnapshot.docs.map((document) => ({
          id: document.id,
          code: document.data().code || document.id,
          ...document.data(),
        }));

        const metaMap = buildDepartmentMetaMap(loadedDepartments);

        const loadedDailyRows = dailySnapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        const loadedStatsRows = statsSnapshot.docs.map((document) => ({
          id: document.id,
          code: document.id,
          ...document.data(),
        }));

        setDepartmentsRows(loadedDepartments);
        setDailyRows(enrichDailyRows(loadedDailyRows, metaMap));
        setStatsRows(enrichStatsRows(loadedStatsRows, metaMap));
      } catch (error) {
        console.error(error);
        setErrorMessage(
          "Impossible de charger les graphiques. Les données ont décidé de jouer à cache-cache."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const departmentMetaMap = useMemo(
    () => buildDepartmentMetaMap(departmentsRows),
    [departmentsRows]
  );

  const regionOptions = useMemo(
    () => collectRegions(departmentsRows),
    [departmentsRows]
  );

  const departmentOptions = useMemo(() => {
    const filtered = departmentsRows
      .filter((row) => {
        if (scope === 'region') return normalizeRegion(row.region) === selectedRegion;
        if (scope === 'department' && selectedRegion) {
          return normalizeRegion(row.region) === selectedRegion;
        }
        return true;
      })
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));

    return filtered;
  }, [departmentsRows, scope, selectedRegion]);

  const aggregatedDailySeries = useMemo(
    () => aggregateDailySeries(dailyRows, scope, selectedRegion, selectedDepartment),
    [dailyRows, scope, selectedRegion, selectedDepartment]
  );

  const availableSectors = useMemo(() => {
    return aggregateSectors(statsRows, scope, selectedRegion, selectedDepartment)
      .slice(0, 30)
      .map((item) => item.label);
  }, [statsRows, scope, selectedRegion, selectedDepartment]);

  const selectedScopeLabel = useMemo(
    () => buildScopeLabel(scope, selectedRegion, selectedDepartment, departmentMetaMap),
    [scope, selectedRegion, selectedDepartment, departmentMetaMap]
  );

  const currentValues = useMemo(
    () => aggregatedDailySeries.map((row) => safeNumber(row[criterion])),
    [aggregatedDailySeries, criterion]
  );

  const movingAverageSeries = useMemo(
    () => movingAverage(currentValues, 7),
    [currentValues]
  );

  const forecastValues = useMemo(
    () => buildForecast(currentValues, 7),
    [currentValues]
  );

  const vigilanceSeries = useMemo(
    () => computeVigilanceLevels(aggregatedDailySeries, criterion),
    [aggregatedDailySeries, criterion]
  );

  const sectorsDataRows = useMemo(() => {
    const rows = aggregateSectors(statsRows, scope, selectedRegion, selectedDepartment);
    if (!selectedSector) return rows.slice(0, 12);

    const selected = rows.find((item) => item.label === selectedSector);
    const others = rows.filter((item) => item.label !== selectedSector).slice(0, 11);
    return selected ? [selected, ...others] : rows.slice(0, 12);
  }, [statsRows, scope, selectedRegion, selectedDepartment, selectedSector]);

  const rankingRows = useMemo(() => {
    if (scope === 'national') {
      return aggregateRegionsByCurrentStats(statsRows).slice(0, 12);
    }

    return aggregateDepartments(
      statsRows,
      scope === 'region' ? selectedRegion : ''
    ).slice(0, 12);
  }, [statsRows, scope, selectedRegion]);

  const latestValue = lastDefined(currentValues);
  const previousValue =
    currentValues.length > 1 ? currentValues[currentValues.length - 2] : latestValue;
  const latestMa7 = lastDefined(movingAverageSeries);
  const latestVigilance = vigilanceSeries[vigilanceSeries.length - 1] || {
    level: 'Vert',
    color: LEVEL_META.Vert.color,
    dailyDelta: 0,
    maDelta: 0,
  };

  const chartLabels = aggregatedDailySeries.map((row) => formatDateLabel(row.date));
  const forecastLabels = aggregatedDailySeries.length
    ? Array.from({ length: 7 }, (_, index) =>
        formatDateLabel(addDays(aggregatedDailySeries[aggregatedDailySeries.length - 1].date, index + 1))
      )
    : [];

  const combinedLabels = [...chartLabels, ...forecastLabels];

  const actualDataset = [
    ...currentValues,
    ...Array.from({ length: forecastValues.length }, () => null),
  ];

  const maDataset = [
    ...movingAverageSeries,
    ...Array.from({ length: forecastValues.length }, () => null),
  ];

  const forecastDataset = [
    ...Array.from({ length: Math.max(currentValues.length - 1, 0) }, () => null),
    currentValues.length ? currentValues[currentValues.length - 1] : null,
    ...forecastValues,
  ];

  const pointColors = vigilanceSeries.map((item) => item.color);

  const lineData = {
    labels: combinedLabels,
    datasets: [
      {
        label: CRITERIA[criterion].label,
        data: actualDataset,
        tension: 0.3,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 5,
        pointBackgroundColor: [...pointColors, ...Array.from({ length: forecastValues.length }, () => '#cbd5e1')],
        pointBorderColor: [...pointColors, ...Array.from({ length: forecastValues.length }, () => '#cbd5e1')],
        borderColor: '#0f172a',
        segment: {
          borderColor: (ctx) => {
            const idx = ctx.p1DataIndex;
            return pointColors[idx] || '#0f172a';
          },
        },
      },
      {
        label: 'Moyenne mobile 7 jours',
        data: maDataset,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
        borderColor: '#64748b',
      },
      {
        label: 'Projection J+7',
        data: forecastDataset,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
        borderDash: [8, 6],
        borderColor: '#2563eb',
      },
    ],
  };

  const vigilanceBandData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Niveau de vigilance',
        data: vigilanceSeries.map((item) => item.score),
        tension: 0.25,
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        fill: false,
        segment: {
          borderColor: (ctx) => pointColors[ctx.p1DataIndex] || '#1f8f55',
        },
      },
    ],
  };

  const sectorsBarData = {
    labels: sectorsDataRows.map((row) => row.label),
    datasets: [
      {
        label: 'Volume observé sur 30 jours',
        data: sectorsDataRows.map((row) => row.count),
        borderWidth: 1,
        backgroundColor: sectorsDataRows.map((row) =>
          row.label === selectedSector ? '#2563eb' : '#93c5fd'
        ),
        borderColor: sectorsDataRows.map((row) =>
          row.label === selectedSector ? '#1d4ed8' : '#60a5fa'
        ),
      },
    ],
  };

  const rankingCriterion = criterion === 'recruitersCount' ? 'recruitersCount' : 'jobsCount';
  const rankingLabel =
    scope === 'national' ? 'Top régions' : 'Top départements';

  const rankingBarData = {
    labels: rankingRows.map((row) => row.label),
    datasets: [
      {
        label:
          rankingCriterion === 'jobsCount'
            ? 'Offres observées sur 30 jours'
            : 'Recruteurs observés',
        data: rankingRows.map((row) => safeNumber(row[rankingCriterion])),
        borderWidth: 1,
        backgroundColor: '#cbd5e1',
        borderColor: '#94a3b8',
      },
    ],
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'bottom',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  const vigilanceOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'bottom',
      },
      tooltip: {
        callbacks: {
          label(context) {
            const score = context.parsed.y;
            const mapping = {
              1: 'Vert',
              2: 'Jaune',
              3: 'Orange',
              4: 'Rouge',
            };
            return `Vigilance : ${mapping[score] || score}`;
          },
        },
      },
    },
    scales: {
      y: {
        min: 1,
        max: 4,
        ticks: {
          stepSize: 1,
          callback(value) {
            const mapping = {
              1: 'Vert',
              2: 'Jaune',
              3: 'Orange',
              4: 'Rouge',
            };
            return mapping[value] || value;
          },
        },
      },
    },
  };

  const horizontalBarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: {
        position: 'bottom',
      },
    },
    scales: {
      x: {
        beginAtZero: true,
      },
    },
  };

  if (loading) {
    return (
      <section className="admin-charts-panel">
        <div className="admin-card">
          <p>Chargement des graphiques…</p>
        </div>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="admin-charts-panel">
        <div className="admin-card admin-card-warning">
          <p>{errorMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-charts-panel">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Observatoire</p>
          <h2>Graphiques ciblés et tendances</h2>
        </div>
        <p className="admin-muted">
          Vue filtrable par périmètre, critère et secteur, avec lecture du
          contexte et projection J+7.
        </p>
      </div>

      <div className="admin-filters-panel">
        <div className="admin-filters-grid">
          <label className="admin-filter-field">
            <span>Périmètre</span>
            <select
              value={scope}
              onChange={(event) => {
                const nextScope = event.target.value;
                setScope(nextScope);
                if (nextScope === 'national') {
                  setSelectedRegion('');
                  setSelectedDepartment('');
                }
                if (nextScope === 'region') {
                  setSelectedDepartment('');
                }
              }}
            >
              <option value="national">France entière</option>
              <option value="region">Région</option>
              <option value="department">Département</option>
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Critère</span>
            <select
              value={criterion}
              onChange={(event) => setCriterion(event.target.value)}
            >
              <option value="jobsCount">Offres créées</option>
              <option value="openingCount">Postes à pourvoir</option>
              <option value="recruitersCount">Recruteurs observés</option>
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Région</span>
            <select
              value={selectedRegion}
              onChange={(event) => {
                setSelectedRegion(event.target.value);
                setSelectedDepartment('');
              }}
              disabled={scope === 'national'}
            >
              <option value="">Toutes / choisir</option>
              {regionOptions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Département</span>
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              disabled={scope !== 'department'}
            >
              <option value="">Choisir un département</option>
              {departmentOptions.map((department) => (
                <option key={department.code} value={department.code}>
                  {department.code} — {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-filter-field admin-filter-field-wide">
            <span>Secteur</span>
            <select
              value={selectedSector}
              onChange={(event) => setSelectedSector(event.target.value)}
            >
              <option value="">Tous les secteurs</option>
              {availableSectors.map((sector) => (
                <option key={sector} value={sector}>
                  {sector}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <article className="admin-kpi-card">
          <span className="admin-kpi-label">{CRITERIA[criterion].label}</span>
          <strong>{formatNumber(latestValue)}</strong>
          <p>
            Variation J-1 : {formatPercent(percentChange(latestValue, previousValue))}
          </p>
        </article>

        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Moyenne mobile 7 jours</span>
          <strong>{formatNumber(latestMa7)}</strong>
          <p>
            Écart vs MA7 : {formatPercent(percentChange(latestValue, latestMa7))}
          </p>
        </article>

        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Vigilance calculée</span>
          <strong style={{ color: latestVigilance.color }}>
            {latestVigilance.level}
          </strong>
          <p>{selectedScopeLabel}</p>
        </article>

        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Contexte</span>
          <strong>
            {aggregatedDailySeries.length
              ? isWeekend(aggregatedDailySeries[aggregatedDailySeries.length - 1].date)
                ? 'Week-end'
                : 'Jour ouvré'
              : 'N/A'}
          </strong>
          <p>
            Le week-end freine naturellement les créations d’offres.
          </p>
        </article>
      </div>

      {selectedSector && (
        <div className="admin-inline-note">
          <strong>Note secteur</strong>
          <p>
            La courbe temporelle reste calculée sur le périmètre géographique
            sélectionné. Le secteur choisi affine pour l’instant la lecture
            “répartition 30 jours”. Pour une vraie courbe sectorielle
            journalière, il faudra stocker un historique quotidien par secteur.
          </p>
        </div>
      )}

      <div className="admin-chart-grid">
        <article className="admin-chart-card admin-chart-card-wide">
          <div className="admin-chart-card-header">
            <div>
              <h3>Courbe principale</h3>
              <p>
                {CRITERIA[criterion].label} — {selectedScopeLabel}
              </p>
            </div>
          </div>
          <div className="admin-chart-box">
            {aggregatedDailySeries.length > 0 ? (
              <Line data={lineData} options={lineOptions} />
            ) : (
              <p className="admin-empty-state">
                Pas encore assez de données pour la courbe.
              </p>
            )}
          </div>
        </article>

        <article className="admin-chart-card admin-chart-card-wide">
          <div className="admin-chart-card-header">
            <div>
              <h3>Courbe de vigilance</h3>
              <p>
                Représentation des niveaux selon le critère, le contexte et la
                tendance.
              </p>
            </div>
          </div>
          <div className="admin-chart-box">
            {aggregatedDailySeries.length > 0 ? (
              <Line data={vigilanceBandData} options={vigilanceOptions} />
            ) : (
              <p className="admin-empty-state">
                Pas encore assez de données pour la vigilance.
              </p>
            )}
          </div>
        </article>

        <article className="admin-chart-card">
          <div className="admin-chart-card-header">
            <div>
              <h3>Secteurs dominants</h3>
              <p>
                Répartition observée sur 30 jours pour {selectedScopeLabel}.
              </p>
            </div>
          </div>
          <div className="admin-chart-box">
            {sectorsDataRows.length > 0 ? (
              <Bar data={sectorsBarData} options={horizontalBarOptions} />
            ) : (
              <p className="admin-empty-state">
                Aucun secteur exploitable pour ce périmètre.
              </p>
            )}
          </div>
        </article>

        <article className="admin-chart-card">
          <div className="admin-chart-card-header">
            <div>
              <h3>{rankingLabel}</h3>
              <p>
                Classement sur la base des statistiques observées.
              </p>
            </div>
          </div>
          <div className="admin-chart-box">
            {rankingRows.length > 0 ? (
              <Bar data={rankingBarData} options={horizontalBarOptions} />
            ) : (
              <p className="admin-empty-state">
                Pas encore de classement disponible.
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
