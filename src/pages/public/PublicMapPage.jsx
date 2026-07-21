import React, { useEffect, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import VigilanceLegend from '../../components/vigilance/VigilanceLegend.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';

export default function PublicMapPage() {
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

  const departments = index?.departments || [];

  return (
    <PublicLayout>
      <section className="hero">
        <p className="kicker">Vigilance apprentissage</p>
        <h1>Lire rapidement la tension du marché par département.</h1>
        <p>
          La carte publique affiche uniquement les vigilances publiées. Les brouillons,
          calculs internes et données non validées restent côté administration.
        </p>
      </section>

      <div className="content-grid">
        <VigilanceMap
          departments={departments}
          loading={loading}
          error={error}
          latestDate={index?.latestDate}
        />

        <aside>
          <VigilanceLegend />

          <section className="panel compact-panel">
            <h2>Publication</h2>
            <p>
              Date : <strong>{index?.latestDate || '-'}</strong>
            </p>
            <p>
              Vigilances publiées : <strong>{index?.publishedCount ?? '-'}</strong>
            </p>
            <p>
              Départements affichés : <strong>{departments.length}</strong>
            </p>
            {index && index.publishedCount === 0 ? (
              <p>
                Aucune vigilance active publiée : les départements sont affichés en vert.
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </PublicLayout>
  );
}
