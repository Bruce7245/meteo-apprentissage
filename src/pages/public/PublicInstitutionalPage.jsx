import React from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';

const pages = {
  'mentions-legales': {
    title: 'Mentions légales',
    eyebrow: 'Informations sur le site',
    lead: 'Les informations légales relatives à ApprentiFR seront présentées sur cette page.',
    heading: 'Publication des informations légales',
    notice: 'Cette page est en préparation. Les coordonnées de l’éditeur, du responsable de publication et les informations complètes d’hébergement doivent être confirmées et ajoutées avant une mise en production définitive.',
  },
  'politique-confidentialite': {
    title: 'Confidentialité',
    eyebrow: 'Protection des données',
    lead: 'ApprentiFR souhaite présenter de façon lisible les traitements de données associés à son site public.',
    heading: 'Une information à compléter',
    notice: 'La politique de confidentialité est en cours de rédaction. Les services utilisés, les éventuels traceurs, les finalités, durées de conservation et modalités de contact devront être vérifiés avant publication. Aucun engagement non vérifié n’est présenté ici.',
  },
  contact: {
    title: 'Contact',
    eyebrow: 'ApprentiFR',
    lead: 'Une question sur les données, la méthodologie ou les publications ?',
    heading: 'Canal de contact en préparation',
    notice: 'Les coordonnées publiques du projet ne sont pas encore renseignées. Elles seront affichées ici après validation, sans utiliser de coordonnées personnelles non autorisées.',
  },
};

export default function PublicInstitutionalPage({ page }) {
  const content = pages[page];
  if (!content) return null;
  return (
    <PublicLayout>
      <div className="af-content-page">
        <header className="af-content-heading">
          <p className="af-overline">{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className="af-content-lead">{content.lead}</p>
        </header>
        <section className="af-content-panel" aria-label={content.heading}>
          <h2>{content.heading}</h2>
          <p>{content.notice}</p>
        </section>
        <div className="af-content-actions"><a href="/">← Retour à l’accueil</a></div>
      </div>
    </PublicLayout>
  );
}
