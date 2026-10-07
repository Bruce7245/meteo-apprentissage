import React, { useEffect, useMemo, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import OccupationSearch from '../../components/occupation/OccupationSearch.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import VigilanceLegend from '../../components/vigilance/VigilanceLegend.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';
import { getPublicOccupationMap } from '../../services/occupationPublicService.js';
import {
  buildOccupationDepartmentUrl,
  buildOccupationMapUrl,
  getRomeSearchState,
} from '../../utils/occupationUtils.js';

export default function PublicOccupationMapPage() {
  const romeState = getRomeSearchState(window.location.search);
  const romeCode = romeState.romeCode;

  const [generalIndex, setGeneralIndex] = useState(null);
  const [occupationResult, setOccupationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function load() {
      if (romeState.present && !romeState.valid) {
        setLoading(false);
        setError('');
        setOccupationResult(null);
        return;
      }

      try {
        setLoading(true);
        setError('');

        if (romeState.present) {
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
      } catch (currentError) {
        if (controller.signal.aborted) return;

        if (alive) {
          setError(
            currentError?.message ||
              'La carte métier est momentanément indisponible.'
          );
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
  }, [romeCode, romeState.present, romeState.valid]);

  const occupationData = occupationResult?.data || null;
  const occupationMode = romeState.present && romeState.valid;
  const romeLabel =
    occupationData?.romeLabel ||
    romeCode ||
    '';

  const departments = useMemo(() => {
    if (occupationMode) {
      return Array.isArray(occupationData?.departments)
        ? occupationData.departments
        : [];
    }

    return Array.isArray(generalIndex?.departments)
      ? generalIndex.departments
      : [];
  }, [occupationMode, occupationData, generalIndex]);

  const latestDate = occupationMode
    ? occupationData?.date || null
    : generalIndex?.latestDate || null;

  function selectOccupation(selection) {
    if (!selection?.romeCode) return;
    window.location.assign(
      buildOccupationMapUrl(selection.romeCode)
    );
  }

  const invalidSelection =
    romeState.present &&
    !romeState.valid;

  const noPublishedOccupation =
    occupationMode &&
    !loading &&
    !error &&
    occupationResult &&
    occupationResult.exists !== true;

  const showMap =
    !invalidSelection &&
    !noPublishedOccupation &&
    (!occupationMode || occupationResult?.exists === true);

  return (
    <PublicLayout>
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="eyebrow">Métiers & formations</p>
          <h1>
            {occupationMode
              ? 'Vigilance métier : ' + romeLabel
              : invalidSelection
                ? 'Sélection métier invalide'
                : 'Explorer l’apprentissage par métier.'}
          </h1>
          <p className="public-hero-intro">
            {occupationMode
              ? 'La carte nationale est recalculée à partir du niveau publié pour le code ROME ' + romeCode + '. Les données insuffisantes restent distinctes du vert.'
              : invalidSelection
                ? 'Le code ROME présent dans l’adresse n’est pas valide. Lancez une nouvelle recherche pour continuer.'
                : 'Recherchez un métier ou une formation. La même carte nationale sera ensuite affichée avec la vigilance du métier sélectionné.'}
          </p>

          {occupationMode ? (
            <div className="occupation-context-actions">
              <a className="button-link" href="/">
                Revenir à la situation générale
              </a>
              <a className="text-link" href="/metiers">
                Effacer le métier
              </a>
            </div>
          ) : null}
        </div>

        <div className="occupation-search-card">
          <p className="eyebrow">Recherche</p>
          <h2>Choisir un métier</h2>
          <p>
            Une formation liée à plusieurs métiers vous demandera de choisir explicitement le code ROME.
          </p>
          <OccupationSearch
            onOccupationSelect={selectOccupation}
            initialRomeCode={romeCode}
            initialLabel={occupationData?.romeLabel || ''}
          />
        </div>
      </section>

      {invalidSelection ? (
        <section
          className="state-box error-box occupation-map-notice"
          role="alert"
        >
          Le paramètre ROME de cette adresse est invalide. La carte générale n’est pas utilisée comme remplacement silencieux.
          <div className="occupation-context-actions">
            <a className="button-link" href="/metiers">
              Rechercher un métier
            </a>
          </div>
        </section>
      ) : null}

      {noPublishedOccupation ? (
        <section
          className="state-box occupation-map-notice"
          aria-live="polite"
        >
          Aucune vigilance métier publiée n’est disponible actuellement pour {romeCode}. Choisissez un autre métier ou revenez à la carte générale.
        </section>
      ) : null}

      {showMap ? (
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
                  : 'Situation générale en attendant votre sélection'}
              </h2>
            </div>
            <p className="section-note">
              {occupationMode
                ? 'Chaque département conserve le contexte ROME dans son lien de détail.'
                : 'Cette carte reste la lecture nationale générale. Recherchez un métier pour activer le filtre.'}
            </p>
          </div>

          <div className="public-map-grid">
            <VigilanceMap
              mode={occupationMode ? 'occupation' : 'public'}
              departments={departments}
              loading={loading}
              error={error}
              latestDate={latestDate}
              contextLabel={occupationMode ? romeLabel : ''}
              missingLevel={
                occupationMode
                  ? 'insufficient_data'
                  : 'green'
              }
              departmentHrefBuilder={
                occupationMode
                  ? (departmentCode) =>
                      buildOccupationDepartmentUrl(
                        departmentCode,
                        romeCode
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
                    ? 'Le métier reste le même partout.'
                    : 'Choisissez un métier pour comparer.'}
                </h3>
                <p>
                  {occupationMode
                    ? 'La couleur n’est jamais utilisée seule : le niveau textuel est annoncé sur chaque département, et « Données insuffisantes » possède son propre état.'
                    : 'Le mode métier réutilise cette carte. Il ne déclenche pas de calcul lourd lors de votre consultation.'}
                </p>
              </section>
            </aside>
          </div>
        </section>
      ) : null}

      {!invalidSelection && loading ? (
        <section className="state-box occupation-map-notice">
          Chargement de la carte…
        </section>
      ) : null}

      {!invalidSelection && error && !showMap ? (
        <section
          className="state-box error-box occupation-map-notice"
          role="alert"
        >
          Impossible de charger la vigilance métier : {error}
          <div className="occupation-context-actions">
            <a className="text-link" href="/">
              La carte nationale générale reste disponible
            </a>
          </div>
        </section>
      ) : null}
    </PublicLayout>
  );
}
