import React from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';

export default function AdminCompaniesDashboardPage() {
  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Entreprises</p>
        <h1>Tableau de bord entreprises</h1>
        <p>
          Suivi des employeurs actifs, codes NAF, départements et croisements avec les offres.
        </p>
      </section>

      <section className="panel">
        <h2>Contexte entreprises</h2>
        <p>Les données INSEE et entreprises seront branchées ici.</p>
      </section>
    </AdminLayout>
  );
}
