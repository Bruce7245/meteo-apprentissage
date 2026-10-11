/*
 * Articles publics ApprentiFR — registre de publication.
 * Aucun article ne doit apparaître publiquement avant validation éditoriale.
 * Un contenu peut être ajouté ultérieurement avec:
 * { slug, title, excerpt, category, publishedAt: 'YYYY-MM-DD',
 *   coverImage: '/illustrations/nom-image.webp', coverAlt: 'Description',
 *   status: 'published', sections: [{ heading, paragraphs: ['...'] }] }
 * coverImage est optionnel ; la carte affiche sinon un décor aux couleurs
 * ApprentiFR. L'illustration doit disposer des droits nécessaires.
 * Ne pas publier de chiffres inventés ni de textes générés non relus.
 */
const articleRegistry = [];

export const editorialTopics = [
  {
    title: 'Territoires',
    description: 'Les évolutions de l’apprentissage et les différences entre départements.',
  },
  {
    title: 'Métiers',
    description: 'Les tendances observées pour les secteurs et les professions.',
  },
  {
    title: 'Méthodologie',
    description: 'L’origine, le sens et les limites des indicateurs publiés.',
  },
];

export function listPublishedArticles() {
  return articleRegistry
    .filter(article => (
      article.status === 'published'
      && typeof article.slug === 'string'
      && typeof article.title === 'string'
      && typeof article.excerpt === 'string'
      && Array.isArray(article.sections)
    ))
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

export function getPublishedArticle(slug) {
  return listPublishedArticles().find(article => article.slug === slug) || null;
}
