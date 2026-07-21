import React from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';

export default function AdminSectorDashboardPage() {
  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Secteurs</p>
        <h1>Tableau de bord secteurs</h1>
        <p>
          Données par secteur : offres, postes, employeurs, couverture, score et tendance.
        </p>
      </section>

      <section className="panel">
        <h2>Données secteurs</h2>
        <p>Le tableau sera branché après les services de lecture Firestore.</p>
      </section>
    </AdminLayout>
  );
}
