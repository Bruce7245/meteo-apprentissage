import React from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';

export default function AdminHomePage() {
  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Pilotage</p>
        <h1>Administration ApprentiFR</h1>
        <p>
          Espace de contrôle des vigilances, bulletins, secteurs, entreprises et publications.
        </p>
      </section>

      <section className="metrics-grid">
        <MetricCard label="Départements publiés" value="-" />
        <MetricCard label="Bulletins à vérifier" value="-" />
        <MetricCard label="Secteurs en tension" value="-" />
        <MetricCard label="Dernier import" value="-" />
      </section>
    </AdminLayout>
  );
}
