import React, { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';

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

  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Publication</p>
        <h1>Carte publiée</h1>
        <p>
          Vue de contrôle de ce que le public voit actuellement.
        </p>
      </section>

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
