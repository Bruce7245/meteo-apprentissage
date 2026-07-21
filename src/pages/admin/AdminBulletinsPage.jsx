import React from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';

export default function AdminBulletinsPage() {
  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Bulletins</p>
        <h1>Pilotage des bulletins</h1>
        <p>
          Ici seront gérés les brouillons, validations, corrections et publications.
        </p>
      </section>

      <section className="panel">
        <h2>File de contrôle</h2>
        <p>Les bulletins à publier seront listés ici.</p>
      </section>
    </AdminLayout>
  );
}
