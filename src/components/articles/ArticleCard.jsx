import React from 'react';

export function formatArticleDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
}

/** Carte utilisée par l'accueil et l'archive ; jamais de faux article. */
export function ArticleCard({ article }) {
  const date = formatArticleDate(article.publishedAt);
  return (
    <article className="af-article-card">
      <div className="af-article-cover">
        {article.coverImage ? (
          <img
            src={article.coverImage}
            alt={article.coverAlt || ''}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="af-article-cover-fallback" aria-hidden="true">
            <span className="af-article-cover-line" />
            <span>ApprentiFR</span>
          </div>
        )}
      </div>
      <div className="af-article-card-content">
        <span className="af-article-tag">{article.category || 'Analyse'}</span>
        <h3>{article.title}</h3>
        <p>{article.excerpt}</p>
        {date ? <time dateTime={article.publishedAt}>{date}</time> : null}
        <a href={'/articles/' + encodeURIComponent(article.slug)}>
          Lire l'article <span aria-hidden="true">→</span>
        </a>
      </div>
    </article>
  );
}

/** Carte thématique informative, sans lien vers un article non publié. */
export function EditorialTopicCard({ topic }) {
  return (
    <article className="af-article-card af-editorial-preview-card">
      <div className="af-article-cover af-article-cover-topic" aria-hidden="true">
        <span className="af-editorial-cover-mark">ApprentiFR</span>
      </div>
      <div className="af-article-card-content">
        <span className="af-article-tag">Thématique à venir</span>
        <h3>{topic.title}</h3>
        <p>{topic.description}</p>
        <span className="af-editorial-preview-note">En préparation</span>
      </div>
    </article>
  );
}
