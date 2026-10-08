import React, { useEffect, useState } from 'react';
import {
  FiCheckCircle,
  FiExternalLink,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';

function formatNumber(value) {
  if (value === null || value === undefined) return '—';

  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('fr-FR').format(number)
    : '—';
}

export default function AdminPublishedMapPage() {
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await getLatestPublicVigilanceIndex();

        if (alive) setIndex(result);
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
  }, []);

  const elevated =
    Number(index?.levels?.orange || 0) +
    Number(index?.levels?.red || 0);

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Publication</p>
          <h1>Carte publiée</h1>
          <p>
            Contrôlez exactement le dernier index de vigilance exposé au site
            public.
          </p>
        </div>

        <div className="admin-console-page-status">
          <span className="admin-console-live-dot" />
          <span>
            <strong>{index?.latestDate || 'Date indisponible'}</strong>
            <small>Référence vigilancePublicIndex/latest</small>
          </span>
        </div>
      </section>

      {!loading && !error ? (
        <>
          <section className="admin-console-overview-grid">
            <MetricCard
              label="Départements indexés"
              value={formatNumber(index?.publishedCount)}
              detail="Entrées explicitement publiées"
            />
            <MetricCard
              label="Jaune"
              value={formatNumber(index?.levels?.yellow)}
              detail="Vigilance modérée"
            />
            <MetricCard
              label="Orange ou rouge"
              value={formatNumber(elevated)}
              detail="Attention renforcée"
            />
            <MetricCard
              label="Référence"
              value={index?.latestDate || '—'}
              detail="Date du dernier index public"
            />
          </section>

          <section className="admin-console-publication-banner">
            <FiCheckCircle aria-hidden="true" />
            <div>
              <strong>Vue de contrôle du public</strong>
              <p>
                Les couleurs et départements ci-dessous proviennent de la même
                source que l’interface publique. Cet écran ne recalcule rien.
              </p>
            </div>
            <a href="/" target="_blank" rel="noreferrer">
              Ouvrir le site public
              <FiExternalLink aria-hidden="true" />
            </a>
          </section>
        </>
      ) : null}

      <VigilanceMap
        mode="admin-published"
        departments={index?.departments || []}
        loading={loading}
        error={error}
        latestDate={index?.latestDate}
      />
    </AdminLayout>
  );
}
