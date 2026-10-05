import React from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import { getRomeFromSearchParams } from '../../utils/occupationUtils.js';

export default function PublicOccupationMapPage() {
  const romeCode = getRomeFromSearchParams(window.location.search);

  return (
    <PublicLayout>
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="eyebrow">Métiers & formations</p>
          <h1>Explorer l’apprentissage par métier.</h1>
          <p className="public-hero-intro">
            {romeCode
              ? `Préparation de la vigilance métier ${romeCode}…`
              : 'Recherchez bientôt un métier ou une formation pour afficher sa vigilance territoriale.'}
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
