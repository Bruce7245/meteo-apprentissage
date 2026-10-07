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
import { getPublicOccupationDepartment } from '../../services/occupationPublicService.js';
import {
  buildOccupationMapUrl,
} from '../../utils/occupationUtils.js';
import {
  getOccupationReasonLabel,
  resolveDepartmentPublicMode,
} from '../../utils/occupationDepartmentUtils.js';
import { getLevelLabel } from '../../utils/levelUtils.js';

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (Number.isNaN(number)) return String(value);

  return new Intl.NumberFormat('fr-FR').format(number);
}

function formatDate(value) {
  if (!value) return null;

  const date = new Date(String(value).includes('T') ? value : value + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('fr-FR', {
    maximumFractionDigits: 2,
  });
}

function getMetric(metrics, keys) {
  for (const key of keys) {
    if (metrics?.[key] !== null && metrics?.[key] !== undefined) {
      return metrics[key];
    }
  }

  return null;
}

function buildOccupationSummary(data, romeLabel) {
  const level = data?.publishedLevel || 'insufficient_data';

  if (level === 'insufficient_data') {
    return (
      'Les données publiées ne permettent pas encore d’établir une vigilance fiable pour ' +
      romeLabel +
      ' dans ce département.'
    );
  }

  const offers = Number(data?.activeOffersCount);
  const observedText = Number.isFinite(offers)
    ? ' ' + formatNumber(offers) + ' offre(s) active(s) sont observée(s).'
    : '';

  return (
    'Le moteur déterministe publie un niveau ' +
    getLevelLabel(level) +
    ' pour ' +
    romeLabel +
    '.' +
    observedText +
    ' Les motifs ci-dessous expliquent ce résultat sans intervention de l’IA.'
  );
}

function PublicOfferCards({
  offersData,
  offersError,
  occupationMode,
}) {
  if (!offersData?.offers?.length) {
    return (
      <div className="empty-state">
        <strong>Aucune offre récente disponible.</strong>
        <p>
          {offersError ||
            (occupationMode
              ? 'Aucune offre récente correspondant exactement à ce code ROME n’est disponible dans le département.'
              : 'Aucun snapshot récent d’offres n’est disponible pour ce département.')}
        </p>
      </div>
    );
  }

  const visibleOffers = offersData.offers.slice(0, 8);

  return (
    <>
      <div className="offer-cards-grid">
        {visibleOffers.map((offer, index) => (
          <article
            className="public-offer-card"
            key={
              String(offer.title || 'offre') +
              '_' +
              String(offer.companyName || 'entreprise') +
              '_' +
              String(index)
            }
          >
            <div className="public-offer-card-head">
              <span className="soft-pill">
                {formatNumber(offer.openingCount)} poste
                {Number(offer.openingCount) > 1 ? 's' : ''}
              </span>
              {offer.sectorLabel ? (
                <span className="offer-sector">{offer.sectorLabel}</span>
              ) : null}
            </div>

            <h3>{offer.title || 'Offre d’apprentissage'}</h3>

            <div className="offer-company-line">
              <strong>
                {offer.companyName || 'Employeur non renseigné'}
              </strong>
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
              <span className="offer-link-unavailable">
                Lien de candidature indisponible
              </span>
            )}
          </article>
        ))}
      </div>

      {offersData.totalOffers > visibleOffers.length ? (
        <p className="offers-disclaimer">
          Aperçu de 8 offres sur {formatNumber(offersData.totalOffers)} observées
          {occupationMode ? ' pour ce métier' : ' dans le département'}.
        </p>
      ) : null}
    </>
  );
}

export default function PublicDepartmentPage({ departmentCode }) {
  const code = normalizeDepartmentCode(departmentCode);
  const modeState = resolveDepartmentPublicMode(window.location.search);
  const publicMode = modeState.mode;
  const romeCode = modeState.romeCode;
  const occupationMode = publicMode === 'occupation';
  const invalidOccupationMode = publicMode === 'invalid_occupation';

  const [latestIndex, setLatestIndex] = useState(null);
  const [detail, setDetail] = useState(null);
  const [occupationDetail, setOccupationDetail] = useState(null);
  const [sectors, setSectors] = useState([]);
  const [formationStats, setFormationStats] = useState(null);
  const [formationStatsError, setFormationStatsError] = useState('');
  const [offersData, setOffersData] = useState(null);
  const [offersError, setOffersError] = useState('');
  const [loading, setLoading] = useState(!invalidOccupationMode);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function load() {
      if (invalidOccupationMode) {
        setLoading(false);
        setError('');
        return;
      }

      try {
        setLoading(true);
        setError('');
        setFormationStatsError('');
        setOffersError('');

        if (occupationMode) {
          const [occupationResult, offersResult] = await Promise.all([
            getPublicOccupationDepartment(
              code,
              romeCode,
              { signal: controller.signal }
            ),
            getPublicDepartmentOffers(
              code,
              20,
              {
                romeCode,
                signal: controller.signal,
              }
            ).catch((offersLoadError) => ({
              exists: false,
              data: null,
              error:
                offersLoadError?.message ||
                'Offres métier indisponibles',
            })),
          ]);

          if (!alive) return;

          setOccupationDetail(occupationResult);
          setOffersData(offersResult?.data || null);
          setOffersError(offersResult?.error || '');
          setLatestIndex(null);
          setDetail(null);
          setSectors([]);
          setFormationStats(null);
          return;
        }

        const index = await getLatestPublicVigilanceIndex();
        const targetDate = index.latestDate;

        const [
          departmentResult,
          sectorResults,
          formationResult,
          offersResult,
        ] = await Promise.all([
          getPublishedDepartmentVigilance(code, targetDate),
          getPublishedDepartmentSectorVigilances(code, targetDate),
          getPublicFormationDepartmentStats(code).catch((formationError) => ({
            exists: false,
            data: null,
            error:
              formationError?.message ||
              'Statistiques formations indisponibles',
          })),
          getPublicDepartmentOffers(code, 20).catch((offersLoadError) => ({
            exists: false,
            data: null,
            error:
              offersLoadError?.message ||
              'Offres indisponibles',
          })),
        ]);

        if (!alive) return;

        setLatestIndex(index);
        setDetail(departmentResult);
        setOccupationDetail(null);
        setSectors(sectorResults);
        setFormationStats(formationResult?.data || null);
        setFormationStatsError(formationResult?.error || '');
        setOffersData(offersResult?.data || null);
        setOffersError(offersResult?.error || '');
      } catch (currentError) {
        if (controller.signal.aborted) return;

        if (alive) {
          setError(currentError?.message || 'Erreur inconnue');
        }
      } finally {
        if (alive && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [
    code,
    romeCode,
    occupationMode,
    invalidOccupationMode,
  ]);

  const globalData = detail?.data || {};
  const fallback = detail?.fallbackFromIndex || {};
  const data = occupationMode
    ? occupationDetail?.data || {}
    : globalData;
  const metrics = globalData.metrics || {};

  const departmentName =
    data.departmentName ||
    fallback.name ||
    'Département ' + code;

  const occupationLabel =
    data.romeLabel ||
    romeCode ||
    'Métier sélectionné';

  const level = occupationMode
    ? data.publishedLevel || 'insufficient_data'
    : globalData.publishedLevel ||
      fallback.publishedLevel ||
      fallback.level ||
      'green';

  const reasons = useMemo(() => {
    if (occupationMode) {
      return Array.isArray(data.reasonCodes)
        ? data.reasonCodes.map(getOccupationReasonLabel)
        : [];
    }

    if (Array.isArray(globalData.reasons)) return globalData.reasons;
    if (Array.isArray(globalData.publicReasons)) {
      return globalData.publicReasons;
    }
    if (globalData.publicSummary) return [globalData.publicSummary];

    return [];
  }, [occupationMode, data.reasonCodes, globalData]);

  const offerHistory = Array.isArray(offersData?.history)
    ? offersData.history
    : [];
  const offerHistoryValues = offerHistory.map(
    (item) => item.totalOffers
  );
  const openingHistoryValues = offerHistory.map(
    (item) => item.totalOpenings
  );

  const occupationNotFound =
    occupationMode &&
    occupationDetail &&
    occupationDetail.exists !== true;

  const publicationDate = occupationMode
    ? data.date || null
    : latestIndex?.latestDate || detail?.date || null;

  if (invalidOccupationMode) {
    return (
      <PublicLayout>
        <nav className="breadcrumb" aria-label="Fil d’Ariane">
          <a href="/metiers">Métiers & formations</a>
          <span aria-hidden="true">/</span>
          <span>Sélection invalide</span>
        </nav>

        <section className="panel error-box" role="alert">
          <p className="eyebrow">Filtre métier</p>
          <h1>Le code ROME de cette adresse est invalide.</h1>
          <p>
            La fiche générale du département n’est pas utilisée comme remplacement silencieux.
          </p>
          <a className="button-link" href="/metiers">
            Rechercher un métier
          </a>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <nav className="breadcrumb" aria-label="Fil d’Ariane">
        <a
          href={
            occupationMode
              ? buildOccupationMapUrl(romeCode)
              : '/'
          }
        >
          {occupationMode
            ? 'Métiers & formations'
            : 'France'}
        </a>
        <span aria-hidden="true">/</span>
        {occupationMode ? (
          <>
            <span>{occupationLabel}</span>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <span>Département {code}</span>
      </nav>

      <section className="department-overview">
        <div className="department-overview-main">
          <DepartmentShape
            code={code}
            level={level}
            label={
              'Silhouette du département ' +
              departmentName +
              ', vigilance ' +
              getLevelLabel(level)
            }
          />

          <div className="department-overview-copy">
            <p className="eyebrow">
              {occupationMode
                ? 'Département ' + code + ' · ' + romeCode
                : 'Département ' + code}
            </p>
            <h1>
              {occupationMode
                ? departmentName + ' — ' + occupationLabel
                : departmentName}
            </h1>
            <p className="department-overview-intro">
              {occupationMode
                ? 'Lecture de la vigilance métier à partir de la projection ROME publiée' +
                  (publicationDate ? ' au ' + publicationDate : '') +
                  '.'
                : 'Lecture de la situation du marché de l’apprentissage à partir des données publiées au ' +
                  (publicationDate || '—') +
                  '.'}
            </p>
          </div>
        </div>

        <div className="department-status-card">
          <span className="department-status-label">
            {occupationMode
              ? 'Vigilance métier'
              : 'Niveau publié'}
          </span>
          <VigilanceBadge level={level} />
          <small>
            {occupationMode
              ? 'Niveau calculé pour le code ROME ' + romeCode + '.'
              : 'Situation observée à la date de publication.'}
          </small>
        </div>
      </section>

      {error ? (
        <section className="panel error-box" role="alert">
          Impossible de charger le département : {error}
        </section>
      ) : null}

      {loading ? (
        <section className="panel state-box">
          Chargement de la situation publiée…
        </section>
      ) : null}

      {occupationNotFound && !loading && !error ? (
        <section className="panel state-box occupation-mode-note">
          <strong>Données métier non publiées pour ce département.</strong>
          <p>
            Aucun résultat ROME {romeCode} n’est disponible dans la publication courante. Aucun niveau vert de remplacement n’est affiché.
          </p>
          <a
            className="text-link"
            href={buildOccupationMapUrl(romeCode)}
          >
            Revenir à la carte métier
          </a>
        </section>
      ) : null}

      {!loading && !error && !occupationNotFound ? (
        <>
          {occupationMode ? (
            <section className="department-metrics-section">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Indicateurs métier</p>
                  <h2>Contexte publié pour {occupationLabel}</h2>
                </div>
                <p className="section-note">
                  Agrégats minimisés : aucune donnée employeur individuelle n’est exposée.
                </p>
              </div>

              <div className="department-kpi-grid occupation-mode-kpis">
                <DepartmentKpiCard
                  label="Offres actives"
                  value={formatNumber(data.activeOffersCount)}
                  detail="Signal principal du moteur de vigilance"
                />
                <DepartmentKpiCard
                  label="Postes à pourvoir"
                  value={formatNumber(data.openingsCount)}
                  detail="Ouvertures déclarées dans les offres"
                />
                <DepartmentKpiCard
                  label="Employeurs observés"
                  value={formatNumber(
                    data.distinctObservedEmployersCount
                  )}
                  detail="Nombre agrégé, sans identité publique"
                />
                <DepartmentKpiCard
                  label="Formations"
                  value={formatNumber(data.formationsCount)}
                  detail="Formations rattachées au ROME"
                />
                <DepartmentKpiCard
                  label="Sessions à venir"
                  value={formatNumber(data.upcomingSessionsCount)}
                  detail="Sessions futures rattachées"
                />
                <DepartmentKpiCard
                  label="Population 15–29 ans"
                  value={formatNumber(data.population15To29)}
                  detail={
                    data.populationReferenceYear
                      ? 'Référence ' + String(data.populationReferenceYear)
                      : 'Contexte démographique'
                  }
                />
              </div>
            </section>
          ) : (
            <section className="department-metrics-section">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Données formations</p>
                  <h2>Couverture de l’offre de formation</h2>
                </div>
                <p className="section-note">
                  {formationStats?.asOfDate
                    ? 'Données agrégées au ' + formationStats.asOfDate + '.'
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
          )}

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
                {occupationMode ? (
                  <div className="department-kpi-grid occupation-mode-kpis">
                    <DepartmentKpiCard
                      label="Offres attendues"
                      value={formatNumber(data.expectedOffers)}
                      detail="Référence issue de la calibration"
                    />
                    <DepartmentKpiCard
                      label="Observé / attendu"
                      value={formatRatio(data.observedVsExpectedRatio)}
                      detail="Rapport utilisé par le moteur déterministe"
                    />
                    <DepartmentKpiCard
                      label="Confiance"
                      value={data.confidenceLevel || '—'}
                      detail="Qualité des signaux contextuels disponibles"
                    />
                  </div>
                ) : (
                  <div className="department-kpi-grid department-kpi-grid-compact">
                    <DepartmentKpiCard
                      label="Score d’analyse"
                      value={formatNumber(globalData.rawScore)}
                      detail="Indicateur technique de synthèse"
                    />
                    <DepartmentKpiCard
                      label="Indice de confiance"
                      value={formatNumber(globalData.confidenceScore)}
                      detail="Qualité du signal disponible"
                    />
                  </div>
                )}

                <div className="department-content-grid">
                  <article className="bulletin-card">
                    <p className="eyebrow">
                      {occupationMode
                        ? 'Lecture déterministe'
                        : 'Bulletin de situation'}
                    </p>
                    <h2>
                      {occupationMode
                        ? occupationLabel
                        : globalData.publicTitle || 'Analyse territoriale'}
                    </h2>
                    <p className="bulletin-summary">
                      {occupationMode
                        ? buildOccupationSummary(data, occupationLabel)
                        : globalData.publicSummary ||
                          fallback.publicSummary ||
                          'Aucun bulletin public détaillé n’est disponible pour ce département.'}
                    </p>

                    {!occupationMode && globalData.publicAdvice ? (
                      <div className="advice-box">
                        <strong>Point d’attention</strong>
                        <p>{globalData.publicAdvice}</p>
                      </div>
                    ) : null}

                    {reasons.length > 0 ? (
                      <div className="bulletin-reasons">
                        <h3>Éléments observés</h3>
                        <ul className="reason-list">
                          {reasons.slice(0, 8).map((reason, index) => (
                            <li key={String(reason) + '_' + String(index)}>
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>

                  <aside className="department-context-card">
                    <p className="eyebrow">À retenir</p>
                    <h3>
                      {occupationMode
                        ? 'Contexte du métier'
                        : 'Comment interpréter ce niveau ?'}
                    </h3>
                    <p>
                      {occupationMode
                        ? 'Le métier et le département restent liés dans l’URL. Un retour à la carte conserve le même code ROME.'
                        : 'La vigilance traduit une situation observée à un instant donné. Elle doit être lue avec les indicateurs, le bulletin et le contexte sectoriel du département.'}
                    </p>

                    {occupationMode ? (
                      <div className="occupation-detail-context">
                        <span>
                          <strong>Tendance récente :</strong>{' '}
                          {data.recentTrend?.status || 'indisponible'}
                        </span>
                        <span>
                          <strong>Saisonnalité :</strong>{' '}
                          {data.seasonality?.status || 'indisponible'}
                        </span>
                      </div>
                    ) : null}

                    <a
                      className="text-link"
                      href={
                        occupationMode
                          ? buildOccupationMapUrl(romeCode)
                          : '/'
                      }
                    >
                      {occupationMode
                        ? 'Revenir à la carte métier'
                        : 'Revenir à la carte nationale'}
                    </a>
                  </aside>
                </div>

                {!occupationMode ? (
                  <section className="sector-section">
                    <div className="section-title-row">
                      <div>
                        <p className="eyebrow">Analyse sectorielle</p>
                        <h2>Secteurs sous vigilance</h2>
                      </div>
                      <span className="soft-pill">
                        {sectors.length} secteur(s)
                      </span>
                    </div>

                    {sectors.length === 0 ? (
                      <div className="empty-state">
                        <strong>Aucune vigilance sectorielle publiée.</strong>
                        <p>
                          Aucun signal sectoriel détaillé n’est disponible pour ce département à cette date.
                        </p>
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
                                <td className="sector-name">
                                  {sector.sectorLabel}
                                </td>
                                <td>
                                  <VigilanceBadge level={sector.level} />
                                </td>
                                <td>
                                  {sector.publicSummary ||
                                    sector.publicAdvice ||
                                    '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="offers" className="department-tab-content">
                <div className="section-title-row offers-tab-heading">
                  <div>
                    <p className="eyebrow">Opportunités</p>
                    <h2>
                      {occupationMode
                        ? 'Offres pour ' + occupationLabel
                        : 'Offres d’apprentissage disponibles'}
                    </h2>
                  </div>
                  <p className="section-note">
                    {offersData?.date
                      ? 'Offres observées le ' +
                        formatDate(offersData.date) +
                        '.'
                      : occupationMode
                        ? 'Dernier snapshot récent filtré sur ce code ROME.'
                        : 'Dernier snapshot récent disponible pour ce département.'}
                  </p>
                </div>

                <div className="department-kpi-grid department-kpi-grid-compact">
                  <DepartmentKpiCard
                    label="Offres actives"
                    value={formatNumber(
                      offersData?.totalOffers ??
                        (occupationMode
                          ? data.activeOffersCount
                          : getMetric(metrics, [
                              'activeOffers',
                              'offers',
                              'totalOffers',
                            ]))
                    )}
                    detail={
                      occupationMode
                        ? 'Offres correspondant exactement au ROME'
                        : 'Offres observées dans le département'
                    }
                    history={offerHistoryValues}
                    trend={offersData?.trends?.offers ?? null}
                    trendLabel="sur l’historique récent"
                  />
                  <DepartmentKpiCard
                    label="Postes à pourvoir"
                    value={formatNumber(
                      offersData?.totalOpenings ??
                        (occupationMode
                          ? data.openingsCount
                          : getMetric(metrics, [
                              'openingCountTotal',
                              'openingCount',
                              'postsToFill',
                            ]))
                    )}
                    detail="Volume déclaré dans les offres"
                    history={openingHistoryValues}
                    trend={offersData?.trends?.openings ?? null}
                    trendLabel="sur l’historique récent"
                  />
                </div>

                <PublicOfferCards
                  offersData={offersData}
                  offersError={offersError}
                  occupationMode={occupationMode}
                />
              </Tabs.Content>
            </Tabs.Root>
          </section>
        </>
      ) : null}
    </PublicLayout>
  );
}
