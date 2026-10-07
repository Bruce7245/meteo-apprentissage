import React, { useEffect, useId, useRef, useState } from 'react';
import { searchAdminOccupations } from '../../services/adminOccupationSearchService.js';
import { resolveOccupationSearchResult } from '../../utils/occupationSearchUtils.js';

function displayResultMeta(result) {
  if (result?.type === 'occupation') {
    return result.romeCode || 'Métier';
  }

  const count = Array.isArray(result?.romeCodes)
    ? result.romeCodes.length
    : 0;

  if (count === 0) return 'Formation sans métier ROME';
  if (count === 1) return '1 métier associé';
  return String(count) + ' métiers associés';
}

export default function AdminOccupationSearch({
  onOccupationSelect,
  initialRomeCode = '',
  initialLabel = '',
}) {
  const listboxId = useId();
  const requestSequence = useRef(0);
  const initialValue = initialLabel || initialRomeCode || '';

  const [query, setQuery] = useState(initialValue);
  const [committedLabel, setCommittedLabel] = useState(initialValue);
  const [results, setResults] = useState([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [pendingTraining, setPendingTraining] = useState(null);

  useEffect(() => {
    const nextInitial = initialLabel || initialRomeCode || '';

    if (!nextInitial || query !== committedLabel) return;

    setQuery(nextInitial);
    setCommittedLabel(nextInitial);
  }, [initialLabel, initialRomeCode, query, committedLabel]);

  useEffect(() => {
    const normalizedQuery = String(query || '').trim();

    if (committedLabel && normalizedQuery === committedLabel) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return undefined;
    }

    if (normalizedQuery.length < 2) {
      setResults([]);
      setHighlightedIndex(-1);
      setLoading(false);
      setError('');
      setMessage('');
      setOpen(false);
      return undefined;
    }

    const currentSequence = requestSequence.current + 1;
    requestSequence.current = currentSequence;
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError('');
        setMessage('');

        const nextResults = await searchAdminOccupations(
          normalizedQuery,
          { signal: controller.signal }
        );

        if (requestSequence.current !== currentSequence) return;

        setResults(nextResults);
        setHighlightedIndex(nextResults.length > 0 ? 0 : -1);
        setOpen(true);

        if (nextResults.length === 0) {
          setMessage('Aucun métier ou formation trouvé.');
        }
      } catch (currentError) {
        if (controller.signal.aborted) return;
        if (requestSequence.current !== currentSequence) return;

        setResults([]);
        setHighlightedIndex(-1);
        setOpen(true);
        setError(
          currentError?.message ||
            'La recherche métiers et formations est indisponible.'
        );
      } finally {
        if (
          !controller.signal.aborted &&
          requestSequence.current === currentSequence
        ) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, committedLabel]);

  function commitSelection(selection) {
    const displayLabel =
      selection?.trainingLabel ||
      selection?.label ||
      selection?.romeCode ||
      '';

    setCommittedLabel(displayLabel);
    setQuery(displayLabel);
    setResults([]);
    setHighlightedIndex(-1);
    setOpen(false);
    setPendingTraining(null);
    setMessage('');

    onOccupationSelect?.(selection);
  }

  function chooseResult(result) {
    const resolution = resolveOccupationSearchResult(result);

    if (resolution.status === 'selected') {
      commitSelection(resolution.selection);
      return;
    }

    if (resolution.status === 'requires_rome_choice') {
      setPendingTraining(resolution);
      setResults([]);
      setHighlightedIndex(-1);
      setOpen(false);
      setMessage(
        'Cette formation correspond à plusieurs métiers. Choisissez le code ROME à afficher.'
      );
      return;
    }

    setPendingTraining(null);
    setMessage(
      resolution.message ||
        'Ce résultat ne peut pas être utilisé pour la carte métier.'
    );
  }

  function choosePendingRome(romeCode) {
    if (!pendingTraining) return;

    commitSelection({
      type: 'training',
      trainingId: pendingTraining.training.trainingId,
      trainingLabel: pendingTraining.training.trainingLabel,
      romeCode,
      label: romeCode,
    });
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    if (!open || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.min(current + 1, results.length - 1)
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.max(current - 1, 0)
      );
      return;
    }

    if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      chooseResult(results[highlightedIndex]);
    }
  }

  const activeOptionId =
    open && highlightedIndex >= 0
      ? listboxId + '-option-' + String(highlightedIndex)
      : undefined;

  return (
    <div className="occupation-search">
      <label className="occupation-search-label" htmlFor={listboxId + '-input'}>
        Métier ou formation
      </label>

      <div className="occupation-search-control">
        <input
          id={listboxId + '-input'}
          className="occupation-search-input"
          type="search"
          value={query}
          placeholder="Ex. boulanger, BTS MCO, D1108…"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          onChange={(event) => {
            setQuery(event.target.value);
            setCommittedLabel('');
            setPendingTraining(null);
          }}
          onFocus={() => {
            if (results.length > 0 || error || message) {
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
        />

        {loading ? (
          <span className="occupation-search-loading" aria-live="polite">
            Recherche…
          </span>
        ) : null}
      </div>

      {open ? (
        <div
          id={listboxId}
          className="occupation-search-results"
          role="listbox"
          aria-label="Résultats de recherche"
        >
          {results.map((result, index) => (
            <button
              id={listboxId + '-option-' + String(index)}
              key={
                result.type === 'occupation'
                  ? 'occupation_' + result.romeCode
                  : 'training_' + String(result.publicId || index)
              }
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={
                index === highlightedIndex
                  ? 'occupation-search-result is-highlighted'
                  : 'occupation-search-result'
              }
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseResult(result)}
            >
              <span>
                <strong>{result.label}</strong>
                <small>
                  {result.type === 'occupation' ? 'Métier' : 'Formation'}
                </small>
              </span>
              <span className="occupation-search-result-meta">
                {displayResultMeta(result)}
              </span>
            </button>
          ))}

          {!loading && results.length === 0 && (error || message) ? (
            <p
              className={
                error
                  ? 'occupation-search-message is-error'
                  : 'occupation-search-message'
              }
              role={error ? 'alert' : 'status'}
            >
              {error || message}
            </p>
          ) : null}
        </div>
      ) : null}

      {pendingTraining ? (
        <fieldset className="occupation-rome-choice">
          <legend>
            Choisir le métier pour « {pendingTraining.training.trainingLabel} »
          </legend>
          <div className="occupation-rome-choice-list">
            {pendingTraining.choices.map((romeCode) => (
              <button
                key={romeCode}
                type="button"
                className="occupation-rome-choice-button"
                onClick={() => choosePendingRome(romeCode)}
              >
                {romeCode}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {!open && !pendingTraining && message ? (
        <p className="occupation-search-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
