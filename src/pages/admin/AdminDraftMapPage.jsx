import React from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';

export default function AdminDraftMapPage() {
  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Prépublication</p>
        <h1>Carte à publier</h1>
        <p>Vue de travail avant validation et publication publique.</p>
      </section>

      <VigilanceMap mode="admin-draft" />
    </AdminLayout>
  );
}
