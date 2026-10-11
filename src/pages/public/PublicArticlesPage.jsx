import React from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import { editorialTopics, getPublishedArticle, listPublishedArticles } from '../../content/publicArticles.js';

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function PublicArticleCards({ articles }) {
  return (
    <div className="af-articles-feature-list">
      {articles.map(article => (
        <article className="af-article-card" key={article.slug}>
          <span className="af-article-tag">{article.category || 'Analyse'}</span>
          <h3>{article.title}</h3>
          <p>{article.excerpt}</p>
          {formatDate(article.publishedAt) ? <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time> : null}
          <a href={'/articles/' + encodeURIComponent(article.slug)}>Lire l'article <span aria-hidden="true">→</span></a>
        </article>
      ))}
    </div>
  );
}

export default function PublicArticlesPage({ slug = null }) {
  const publishedArticles = listPublishedArticles();
  const article = slug === null ? null : getPublishedArticle(slug);

  if (slug !== null) {
    return (
      <PublicLayout>
        <div className="af-content-page">
          {article ? (
            <article>
              <div className="af-content-heading">
                <p className="af-overline">{article.category || 'Analyse'}</p>
                <h1>{article.title}</h1>
                <p className="af-content-lead">{article.excerpt}</p>
                {formatDate(article.publishedAt) ? <time className="af-content-small" dateTime={article.publishedAt}>Publié le {formatDate(article.publishedAt)}</time> : null}
              </div>
              <div className="af-article-body">
                {(article.sections || []).map((section, index) => (
                  <section key={section.heading || index}>
                    {section.heading ? <h2>{section.heading}</h2> : null}
                    {(section.paragraphs || []).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                  </section>
                ))}
              </div>
              <div className="af-content-actions"><a href="/articles">← Toutes les analyses</a></div>
            </article>
          ) : (
            <section className="af-content-heading">
              <p className="af-overline">Articles</p>
              <h1>Article indisponible</h1>
              <p className="af-content-lead">Aucun article publié ne correspond à cette adresse.</p>
              <div className="af-content-actions"><a href="/articles">← Retour aux articles</a></div>
            </section>
          )}
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="af-content-page">
        <header className="af-content-heading">
          <p className="af-overline">ApprentiFR · Informations et décryptages</p>
          <h1>Analyses & articles</h1>
          <p className="af-content-lead">Pour comprendre les évolutions de l’apprentissage, confronter les chiffres à leur contexte et découvrir les dynamiques territoriales.</p>
        </header>
        {publishedArticles.length > 0 ? (
          <section className="af-editorial-topics" aria-labelledby="af-public-articles">
            <h2 id="af-public-articles">Dernières publications</h2>
            <PublicArticleCards articles={publishedArticles} />
          </section>
        ) : (
          <section className="af-content-panel" aria-labelledby="af-no-articles">
            <h2 id="af-no-articles">Les premières analyses se préparent</h2>
            <p>Cette rubrique accueillera prochainement des articles datés et vérifiés. Aucun article n’est encore publié : nous préférons ne pas afficher de fausses actualités.</p>
            <div className="af-content-actions"><a href="/#carte">Explorer la carte des départements →</a><a href="/metiers">Découvrir les métiers →</a></div>
          </section>
        )}
        <section className="af-editorial-topics" aria-labelledby="af-topics-title">
          <h2 id="af-topics-title">Les thèmes à retrouver ici</h2>
          <div className="af-editorial-topics-list">
            {editorialTopics.map(topic => (
              <div className="af-editorial-topic" key={topic.title}>
                <strong>{topic.title}</strong>
                <p>{topic.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
