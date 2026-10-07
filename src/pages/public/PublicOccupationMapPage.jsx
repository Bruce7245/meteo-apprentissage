import React, { useEffect, useMemo, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import OccupationDomainBrowser from '../../components/occupation/OccupationDomainBrowser.jsx';
import JobsFormationsSwitcher from '../../components/JobsFormationsSwitcher.jsx';
import FullscreenSearchDialog from '../../components/FullscreenSearchDialog.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import VigilanceLegend from '../../components/vigilance/VigilanceLegend.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';
import { getPublicOccupationMap } from '../../services/occupationPublicService.js';
import {
  getPublicOccupationDomains,
  getPublicOccupationDomainOccupations,
} from '../../services/occupationDomainPublicService.js';
import {
  buildOccupationDepartmentUrl,
  buildOccupationDomainMapUrl,
  buildOccupationMapUrl,
  getOccupationNavigationState,
} from '../../utils/occupationUtils.js';

export default function PublicOccupationMapPage() {
  const navigation = getOccupationNavigationState(
    window.location.search
  );
  const domainCode = navigation.domainCode;
  const romeCode = navigation.romeCode;

  const [domainsResult, setDomainsResult] = useState({
    domains: [],
    asOfDate: null,
  });
  const [domainResult, setDomainResult] = useState(null);
  const [generalIndex, setGeneralIndex] = useState(null);
  const [occupationResult, setOccupationResult] = useState(null);

  const [loadingDomains, setLoadingDomains] = useState(true);
  const [loadingOccupations, setLoadingOccupations] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);

  const [domainError, setDomainError] = useState('');
  const [occupationsError, setOccupationsError] = useState('');
  const [mapError, setMapError] = useState('');
  const [searchOpen, setSearchOpen] = useState(
    () => new URLSearchParams(window.location.search).get('search') === '1'
  );

  useEffect(() => {
    if (
      navigation.valid &&
      romeCode &&
      (
        navigation.needsCanonicalization ||
        !navigation.domainPresent
      )
    ) {
      window.history.replaceState(
        null,
        '',
        buildOccupationMapUrl(romeCode, domainCode)
      );
    }
  }, [
    domainCode,
    romeCode,
    navigation.domainPresent,
    navigation.needsCanonicalization,
    navigation.valid,
  ]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadDomains() {
      try {
        setLoadingDomains(true);
        setDomainError('');

        const result = await getPublicOccupationDomains({
          signal: controller.signal,
        });

        if (alive) setDomainsResult(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (alive) {
          setDomainError(
            error?.message ||
              'Les secteurs sont momentanément indisponibles.'
          );
        }
      } finally {
        if (alive && !controller.signal.aborted) {
          setLoadingDomains(false);
        }
      }
    }

    loadDomains();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadOccupations() {
      if (!domainCode || !navigation.valid) {
        setDomainResult(null);
        setOccupationsError('');
        setLoadingOccupations(false);
        return;
      }

      try {
        setLoadingOccupations(true);
        setOccupationsError('');

        const result =
          await getPublicOccupationDomainOccupations(
            domainCode,
            { signal: controller.signal }
          );

        if (alive) setDomainResult(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (alive) {
          setDomainResult(null);
          setOccupationsError(
            error?.message ||
              'Les métiers de ce secteur sont momentanément indisponibles.'
          );
        }
      } finally {
        if (alive && !controller.signal.aborted) {
          setLoadingOccupations(false);
        }
      }
    }

    loadOccupations();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [domainCode, navigation.valid]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadMap() {
      if (!navigation.valid) {
        setGeneralIndex(null);
        setOccupationResult(null);
        setLoadingMap(false);
        setMapError('');
        return;
      }

      if (domainCode && !romeCode) {
        setGeneralIndex(null);
        setOccupationResult(null);
        setLoadingMap(false);
        setMapError('');
        return;
      }

      try {
        setLoadingMap(true);
        setMapError('');

        if (romeCode) {
          const result = await getPublicOccupationMap(
            romeCode,
            { signal: controller.signal }
          );

          if (alive) {
            setOccupationResult(result);
            setGeneralIndex(null);
          }
        } else {
          const result = await getLatestPublicVigilanceIndex();

          if (alive) {
            setGeneralIndex(result);
            setOccupationResult(null);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (alive) {
          setMapError(
            error?.message ||
              'La carte métier est momentanément indisponible.'
          );
        }
      } finally {
        if (alive && !controller.signal.aborted) {
          setLoadingMap(false);
        }
      }
    }

    loadMap();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [
    domainCode,
    romeCode,
    navigation.valid,
  ]);

  const selectedDomain = useMemo(
    () =>
      domainsResult.domains.find(
        (domain) => domain.domainCode === domainCode
      ) || null,
    [domainsResult.domains, domainCode]
  );

  const selectedOccupation = useMemo(
    () =>
      domainResult?.occupations?.find(
        (occupation) =>
          occupation.romeCode === romeCode
      ) || null,
    [domainResult, romeCode]
  );

  const occupationData = occupationResult?.data || null;
  const occupationMode = Boolean(
    navigation.valid && romeCode
  );
  const domainMode = Boolean(
    navigation.valid && domainCode && !romeCode
  );
  const generalMode = Boolean(
    navigation.valid && !domainCode && !romeCode
  );

  const occupationUnavailable =
    selectedOccupation?.dataStatus ===
    'insufficient_data';

  const romeLabel =
    occupationData?.romeLabel ||
    selectedOccupation?.label ||
    romeCode ||
    '';

  const domainLabel =
    domainResult?.domainLabel ||
    selectedDomain?.domainLabel ||
    domainCode ||
    '';

  const departments = useMemo(() => {
    if (occupationMode) {
      return Array.isArray(occupationData?.departments)
        ? occupationData.departments
        : [];
    }

    if (generalMode) {
      return Array.isArray(generalIndex?.departments)
        ? generalIndex.departments
        : [];
    }

    return [];
  }, [
    occupationMode,
    occupationData,
    generalMode,
    generalIndex,
  ]);

  const latestDate = occupationMode
    ? occupationData?.date || null
    : generalIndex?.latestDate || null;

  function openSearch() {
    const url = new URL(window.location.href);
    url.searchParams.set('search', '1');
    window.history.replaceState(null, '', url.pathname + url.search);
    setSearchOpen(true);
  }

  function closeSearch() {
    const url = new URL(window.location.href);
    url.searchParams.delete('search');
    window.history.replaceState(null, '', url.pathname + url.search);
    setSearchOpen(false);
  }

  function selectDomain(nextDomainCode) {
    const nextUrl = new URL(
      buildOccupationDomainMapUrl(nextDomainCode),
      window.location.origin
    );
    nextUrl.searchParams.set('search', '1');
    window.location.assign(nextUrl.pathname + nextUrl.search);
  }

  function selectOccupation(occupation) {
    if (
      !occupation?.romeCode ||
      occupation.dataStatus !== 'available'
    ) {
      return;
    }

    window.location.assign(
      buildOccupationMapUrl(
        occupation.romeCode,
        domainCode
      )
    );
  }

  const invalidSelection = !navigation.valid;

  const noPublishedOccupation =
    occupationMode &&
    !loadingMap &&
    !mapError &&
    occupationResult &&
    occupationResult.exists !== true;

  const showGeneralMap =
    generalMode && !invalidSelection;

  const showOccupationMap =
    occupationMode &&
    !invalidSelection &&
    !occupationUnavailable &&
    !noPublishedOccupation &&
    occupationResult?.exists === true;

  return (
    <PublicLayout>
      <JobsFormationsSwitcher active="metiers" />

      <section className="jobs-formations-workspace">
        <div className="jobs-formations-summary-card">
          <p className="eyebrow">Métiers</p>
          <h1>
            {occupationMode
              ? 'Vigilance métier : ' + romeLabel
              : domainMode
                ? 'Secteur : ' + domainLabel
                : invalidSelection
                  ? 'Sélection invalide'
                  : 'Explorer l’apprentissage par secteur.'}
          </h1>

          <p className="public-hero-intro">
            {occupationMode
              ? 'La carte compare la vigilance publiée pour ce métier ROME. Les départements sans données suffisantes restent explicitement distingués.'
              : domainMode
                ? 'Le secteur affine la liste des métiers. Choisissez ensuite un métier disposant de données exploitables pour afficher sa carte.'
                : invalidSelection
                  ? 'Le secteur ou le code ROME présent dans l’adresse n’est pas valide.'
                  : 'Commencez par choisir un secteur professionnel ROME, puis sélectionnez un métier pour afficher sa vigilance territoriale.'}
          </p>

          <div className="jobs-formations-primary-actions">
            <button
              type="button"
              className="jobs-formations-search-trigger"
              onClick={openSearch}
            >
              <span>Rechercher un métier</span>
              <small>Secteur, code ROME ou intitulé</small>
            </button>

            {domainCode ? (
              <div className="occupation-context-actions">
                {occupationMode ? (
                  <a
                    className="button-link"
                    href={buildOccupationDomainMapUrl(domainCode)}
                  >
                    Revenir aux métiers du secteur
                  </a>
                ) : null}

                <a className="text-link" href="/metiers">
                  Réinitialiser
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <FullscreenSearchDialog
        open={searchOpen}
        onClose={closeSearch}
        eyebrow="Recherche métier"
        title="Choisir un secteur puis un métier"
        description="Les métiers sans données suffisantes restent visibles, mais leur carte demeure désactivée."
      >
        <OccupationDomainBrowser
          domains={domainsResult.domains}
          selectedDomainCode={domainCode}
          selectedRomeCode={romeCode}
          domainData={domainResult}
          loadingDomains={loadingDomains}
          loadingOccupations={loadingOccupations}
          domainError={domainError}
          occupationsError={occupationsError}
          onDomainSelect={selectDomain}
          onOccupationSelect={selectOccupation}
        />
      </FullscreenSearchDialog>

      {invalidSelection ? (
        <section
          className="state-box error-box occupation-map-notice"
          role="alert"
        >
          Le secteur ou le code ROME présent dans cette adresse est invalide.
          <div className="occupation-context-actions">
            <a className="button-link" href="/metiers">
              Recommencer
            </a>
          </div>
        </section>
      ) : null}

      {domainMode ? (
        <section className="occupation-domain-guidance">
          <p className="eyebrow">Étape suivante</p>
          <h2>Sélectionnez un métier du secteur.</h2>
          <p>
            La vigilance sectorielle agrégée n’est pas encore publiée. Tant que le moteur secteur #51 n’est pas validé, ApprentiFR n’utilise aucune couleur sectorielle de remplacement.
          </p>
        </section>
      ) : null}

      {occupationUnavailable ? (
        <section
          className="state-box occupation-map-notice"
          aria-live="polite"
        >
          Les données sont actuellement insuffisantes pour ouvrir une vigilance fiable pour {romeCode}. Le métier reste référencé dans son secteur mais son accès cartographique est désactivé.
        </section>
      ) : null}

      {noPublishedOccupation && !occupationUnavailable ? (
        <section
          className="state-box occupation-map-notice"
          aria-live="polite"
        >
          Aucune vigilance métier publiée n’est disponible actuellement pour {romeCode}.
        </section>
      ) : null}

      {showGeneralMap || showOccupationMap ? (
        <section className="public-map-section">
          <div className="section-title-row map-section-heading">
            <div>
              <p className="eyebrow">
                {occupationMode
                  ? 'Carte métier'
                  : 'Contexte national'}
              </p>
              <h2>
                {occupationMode
                  ? 'Situation territoriale — ' + romeLabel
                  : 'Situation générale'}
              </h2>
            </div>

            <p className="section-note">
              {occupationMode
                ? 'Chaque département conserve le secteur et le métier dans son lien de détail.'
                : 'Choisissez un secteur puis un métier pour passer à une lecture spécialisée.'}
            </p>
          </div>

          <div className="public-map-grid">
            <VigilanceMap
              mode={occupationMode ? 'occupation' : 'public'}
              departments={departments}
              loading={loadingMap}
              error={mapError}
              latestDate={latestDate}
              contextLabel={occupationMode ? romeLabel : ''}
              missingLevel={
                occupationMode
                  ? 'insufficient_data'
                  : 'green'
              }
              departmentHrefBuilder={
                occupationMode
                  ? (departmentCodeValue) =>
                      buildOccupationDepartmentUrl(
                        departmentCodeValue,
                        romeCode,
                        domainCode
                      )
                  : null
              }
            />

            <aside className="public-map-aside">
              <VigilanceLegend />

              <section className="information-card">
                <p className="eyebrow">Lecture</p>
                <h3>
                  {occupationMode
                    ? 'Une vigilance métier, pas une moyenne de secteur.'
                    : 'Le secteur sert d’abord à orienter la recherche.'}
                </h3>
                <p>
                  {occupationMode
                    ? 'La carte utilise uniquement la publication du métier sélectionné. Une donnée insuffisante n’est jamais transformée en vert.'
                    : 'Les cartes sectorielles seront activées seulement lorsque leur moteur indépendant sera validé et publié.'}
                </p>
              </section>
            </aside>
          </div>
        </section>
      ) : null}

      {!invalidSelection && loadingMap ? (
        <section className="state-box occupation-map-notice">
          Chargement de la carte…
        </section>
      ) : null}

      {!invalidSelection && mapError && !showGeneralMap && !showOccupationMap ? (
        <section
          className="state-box error-box occupation-map-notice"
          role="alert"
        >
          Impossible de charger la vigilance métier : {mapError}
        </section>
      ) : null}
    </PublicLayout>
  );
}
