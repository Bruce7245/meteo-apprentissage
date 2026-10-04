import React, { useEffect, useMemo, useState } from 'react';
import { Tabs } from '@chakra-ui/react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import DepartmentKpiCard from '../../components/dashboard/DepartmentKpiCard.jsx';
import DepartmentShape from '../../components/maps/DepartmentShape.jsx';
import VigilanceBadge from '../../components/vigilance/VigilanceBadge.jsx';
import {
  getLatestPublicVigilanceIndex,
  getPublishedDepartmentSectorVigilances,
  getPublishedDepartmentVigilance,
} from '../../services/vigilanceService.js';
import { normalizeDepartmentCode } from '../../utils/departmentUtils.js';
import { getPublicFormationDepartmentStats } from '../../services/formationPublicService.js';
import { getPublicDepartmentOffers } from '../../services/publicOffersService.js';

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (Number.isNaN(number)) return String(value);

  return new Intl.NumberFormat('fr-FR').format(number);
}

function formatDate(value) {
  if (!value) return null;

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function getMetric(metrics, keys) {
  for (const key of keys) {
    if (metrics?.[key] !== null && metrics?.[key] !== undefined) {
      return metrics[key];
    }
  }

  return null;
}

export default function PublicDepartmentPage({ departmentCode }) {
  const code = normalizeDepartmentCode(departmentCode);

  const [latestIndex, setLatestIndex] = useState(null);
  const [detail, setDetail] = useState(null);
  const [sectors, setSectors] = useState([]);
  const [formationStats, setFormationStats] = useState(null);
  const [formationStatsError, setFormationStatsError] = useState('');
  const [offersData, setOffersData] = useState(null);
  const [offersError, setOffersError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        setFormationStatsError('');
        setOffersError('');

        const index = await getLatestPublicVigilanceIndex();
        const targetDate = index.latestDate;

        const [departmentResult, sectorResults, formationResult, offersResult] = await Promise.all([
          getPublishedDepartmentVigilance(code, targetDate),
          getPublishedDepartmentSectorVigilances(code, targetDate),
          getPublicFormationDepartmentStats(code).catch((formationError) => ({
            exists: false,
            data: null,
            error: formationError?.message || 'Statistiques formations indisponibles',
          })),
          getPublicDepartmentOffers(code, 20).catch((offersLoadError) => ({
            exists: false,
            data: null,
            error: offersLoadError?.message || 'Offres indisponibles',
          })),
        ]);

        if (!alive) return;

        setLatestIndex(index);
        setDetail(departmentResult);
        setSectors(sectorResults);
        setFormationStats(formationResult?.data || null);
        setFormationStatsError(formationResult?.error || '');
        setOffersData(offersResult?.data || null);
        setOffersError(offersResult?.error || '');
      } catch (currentError) {
        if (alive) {
          setError(currentError?.message || 'Erreur inconnue');
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [code]);

  const data = detail?.data || {};
  const fallback = detail?.fallbackFromIndex || {};
  const metrics = data.metrics || {};

  const departmentName = data.departmentName || fallback.name || `Département ${code}`;
  const level = data.publishedLevel || fallback.publishedLevel || fallback.level || 'green';

  const reasons = useMemo(() => {
    if (Array.isArray(data.reasons)) return data.reasons;
    if (Array.isArray(data.publicReasons)) return data.publicReasons;
    if (data.publicSummary) return [data.publicSummary];

    return [];
  }, [data]);

  const offerHistory = Array.isArray(offersData?.history) ? offersData.history : [];
  const offerHistoryValues = offerHistory.map((item) => item.totalOffers);
  const openingHistoryValues = offerHistory.map((item) => item.totalOpenings);

  return (
    <PublicLayout>
      <nav className="breadcrumb" aria-label="Fil d’Ariane">
        <a href="/">France</a>
        <span aria-hidden="true">/</span>
        <span>Département {code}</span>
      </nav>

      <section className="department-overview">
        <div className="department-overview-main">
          <DepartmentShape
            code={code}
            level={level}
            label={`Silhouette du département ${departmentName}, vigilance ${level}`}
          />

          <div className="department-overview-copy">
            <p className="eyebrow">Département {code}</p>
            <h1>{departmentName}</h1>
            <p className="department-overview-intro">
              Lecture de la situation du marché de l’apprentissage à partir des données publiées au{' '}
              {latestIndex?.latestDate || detail?.date || '—'}.
            </p>
          </div>
        </div>

        <div className="department-status-card">
          <span className="department-status-label">Niveau publié</span>
          <VigilanceBadge level={level} />
          <small>Situation observée à la date de publication.</small>
        </div>
      </section>

      {error ? (
        <section className="panel error-box">
          Impossible de charger le département : {error}
        </section>
      ) : null}

      {loading ? (
        <section className="panel state-box">
          Chargement de la situation publiée…
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="department-metrics-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Données formations</p>
                <h2>Couverture de l’offre de formation</h2>
              </div>
              <p className="section-note">
                {formationStats?.asOfDate
                  ? `Données agrégées au ${formationStats.asOfDate}.`
                  : 'Agrégats disponibles lorsque le département a été importé.'}
              </p>
            </div>

            {formationStats ? (
              <div className="department-kpi-grid">
                <DepartmentKpiCard
                  label="Formations"
                  value={formatNumber(formationStats.formationsCount)}
                  detail="Formations recensées dans le département"
                />
                <DepartmentKpiCard
                  label="Sessions"
                  value={formatNumber(formationStats.sessionsCount)}
                  detail="Sessions rattachées aux formations"
                />
                <DepartmentKpiCard
                  label="Sessions à venir"
                  value={formatNumber(formationStats.upcomingSessionsCount)}
                  detail="Sessions dont le démarrage est à venir"
                />
                <DepartmentKpiCard
                  label="Secteurs couverts"
                  value={formatNumber(formationStats.sectorsCount)}
                  detail="Secteurs représentés dans les données importées"
                />
              </div>
            ) : (
              <div className="empty-state">
                <strong>Données de formation non disponibles.</strong>
                <p>
                  {formationStatsError ||
                    'Aucun agrégat de formation n’est encore disponible pour ce département.'}
                </p>
              </div>
            )}
          </section>

          <section className="department-tabs-section">
            <Tabs.Root defaultValue="bulletin" className="department-tabs">
              <Tabs.List className="department-tabs-list">
                <Tabs.Trigger value="bulletin" className="department-tab-trigger">
                  Bulletin de vigilance
                </Tabs.Trigger>
                <Tabs.Trigger value="offers" className="department-tab-trigger">
                  Offres d’apprentissage
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="bulletin" className="department-tab-content">
                <div className="department-kpi-grid department-kpi-grid-compact">
                  <DepartmentKpiCard
                    label="Score d’analyse"
                    value={formatNumber(data.rawScore)}
                    detail="Indicateur technique de synthèse"
                  />
                  <DepartmentKpiCard
                    label="Indice de confiance"
                    value={formatNumber(data.confidenceScore)}
                    detail="Qualité du signal disponible"
                  />
                </div>

                <div className="department-content-grid">
                  <article className="bulletin-card">
                    <p className="eyebrow">Bulletin de situation</p>
                    <h2>{data.publicTitle || 'Analyse territoriale'}</h2>
                    <p className="bulletin-summary">
                      {data.publicSummary ||
                        fallback.publicSummary ||
                        'Aucun bulletin public détaillé n’est disponible pour ce département.'}
                    </p>

                    {data.publicAdvice ? (
                      <div className="advice-box">
                        <strong>Point d’attention</strong>
                        <p>{data.publicAdvice}</p>
                      </div>
                    ) : null}

                    {reasons.length > 0 ? (
                      <div className="bulletin-reasons">
                        <h3>Éléments observés</h3>
                        <ul className="reason-list">
                          {reasons.slice(0, 5).map((reason, index) => (
                            <li key={`${reason}_${index}`}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>

                  <aside className="department-context-card">
                    <p className="eyebrow">À retenir</p>
                    <h3>Comment interpréter ce niveau ?</h3>
                    <p>
                      La vigilance traduit une situation observée à un instant donné. Elle doit être lue avec les indicateurs, le bulletin et le contexte sectoriel du département.
                    </p>
                    <a className="text-link" href="/">Revenir à la carte nationale</a>
                  </aside>
                </div>

                <section className="sector-section">
                  <div className="section-title-row">
                    <div>
                      <p className="eyebrow">Analyse sectorielle</p>
                      <h2>Secteurs sous vigilance</h2>
                    </div>
                    <span className="soft-pill">{sectors.length} secteur(s)</span>
                  </div>

                  {sectors.length === 0 ? (
                    <div className="empty-state">
                      <strong>Aucune vigilance sectorielle publiée.</strong>
                      <p>Aucun signal sectoriel détaillé n’est disponible pour ce département à cette date.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="simple-table sector-table">
                        <thead>
                          <tr>
                            <th>Secteur</th>
                            <th>Vigilance</th>
                            <th>Lecture publiée</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sectors.map((sector) => (
                            <tr key={sector.id}>
                              <td className="sector-name">{sector.sectorLabel}</td>
                              <td>
                                <VigilanceBadge level={sector.level} />
                              </td>
                              <td>{sector.publicSummary || sector.publicAdvice || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </Tabs.Content>

              <Tabs.Content value="offers" className="department-tab-content">
                <div className="section-title-row offers-tab-heading">
                  <div>
                    <p className="eyebrow">Opportunités</p>
                    <h2>Offres d’apprentissage disponibles</h2>
                  </div>
                  <p className="section-note">
                    {offersData?.date
                      ? `Offres observées le ${formatDate(offersData.date)}.`
                      : 'Dernier snapshot récent disponible pour ce département.'}
                  </p>
                </div>

                <div className="department-kpi-grid department-kpi-grid-compact">
                  <DepartmentKpiCard
                    label="Offres actives"
                    value={formatNumber(
                      offersData?.totalOffers ??
                        getMetric(metrics, ['activeOffers', 'offers', 'totalOffers'])
                    )}
                    detail="Offres observées dans le département"
                    history={offerHistoryValues}
                    trend={offersData?.trends?.offers ?? null}
                    trendLabel="sur l’historique récent"
                  />
                  <DepartmentKpiCard
                    label="Postes à pourvoir"
                    value={formatNumber(
                      offersData?.totalOpenings ??
                        getMetric(metrics, ['openingCountTotal', 'openingCount', 'postsToFill'])
                    )}
                    detail="Volume déclaré dans les offres"
                    history={openingHistoryValues}
                    trend={offersData?.trends?.openings ?? null}
                    trendLabel="sur l’historique récent"
                  />
                </div>

                {offersData?.offers?.length > 0 ? (
                  <>
                    <div className="offer-cards-grid">
                      {offersData.offers.slice(0, 8).map((offer, index) => (
                        <article
                          className="public-offer-card"
                          key={`${offer.title || 'offre'}_${offer.companyName || 'entreprise'}_${index}`}
                        >
                          <div className="public-offer-card-head">
                            <span className="soft-pill">
                              {formatNumber(offer.openingCount)} poste{Number(offer.openingCount) > 1 ? 's' : ''}
                            </span>
                            {offer.sectorLabel ? (
                              <span className="offer-sector">{offer.sectorLabel}</span>
                            ) : null}
                          </div>

                          <h3>{offer.title || 'Offre d’apprentissage'}</h3>

                          <div className="offer-company-line">
                            <strong>{offer.companyName || 'Employeur non renseigné'}</strong>
                            {offer.city ? <span>{offer.city}</span> : null}
                          </div>

                          <dl className="offer-meta-list">
                            {offer.contractTypes?.length ? (
                              <div>
                                <dt>Contrat</dt>
                                <dd>{offer.contractTypes.join(', ')}</dd>
                              </div>
                            ) : null}
                            {offer.contractStartDate ? (
                              <div>
                                <dt>Début</dt>
                                <dd>{formatDate(offer.contractStartDate)}</dd>
                              </div>
                            ) : null}
                            {offer.publicationExpirationDate ? (
                              <div>
                                <dt>Expire le</dt>
                                <dd>{formatDate(offer.publicationExpirationDate)}</dd>
                              </div>
                            ) : null}
                          </dl>

                          {offer.applyUrl ? (
                            <a
                              className="offer-apply-link"
                              href={offer.applyUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Voir l’offre
                              <span aria-hidden="true">↗</span>
                            </a>
                          ) : (
                            <span className="offer-link-unavailable">Lien de candidature indisponible</span>
                          )}
                        </article>
                      ))}
                    </div>

                    {offersData.totalOffers > offersData.offers.slice(0, 8).length ? (
                      <p className="offers-disclaimer">
                        Aperçu de 8 offres sur {formatNumber(offersData.totalOffers)} observées dans le département.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">
                    <strong>Aucune offre récente disponible.</strong>
                    <p>
                      {offersError ||
                        'Aucun snapshot récent d’offres n’est disponible pour ce département.'}
                    </p>
                  </div>
                )}
              </Tabs.Content>
            </Tabs.Root>
          </section>
        </>
      ) : null}
    </PublicLayout>
  );
}
