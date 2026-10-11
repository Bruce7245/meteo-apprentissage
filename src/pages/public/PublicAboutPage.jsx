import React from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import '../../about-public.css';

const workingPrinciples = [
  {
    number: '01',
    title: 'Observer',
    description: 'Rassembler les informations disponibles sur les offres, les métiers et les formations en apprentissage.',
  },
  {
    number: '02',
    title: 'Mettre en perspective',
    description: 'Lire ces signaux selon les territoires, les périodes et le contexte statistique accessible.',
  },
  {
    number: '03',
    title: 'Expliquer',
    description: 'Présenter les tendances et les vigilances avec leurs sources, leurs limites et les précautions nécessaires.',
  },
];

const audiences = [
  {
    title: 'Jeunes et familles',
    description: 'Pour découvrir les réalités d’un métier ou d’un département avant de faire des choix.',
  },
  {
    title: 'Organismes de formation et CFA',
    description: 'Pour disposer de repères supplémentaires sur les dynamiques locales de l’apprentissage.',
  },
  {
    title: 'Employeurs et acteurs des territoires',
    description: 'Pour mieux situer un secteur professionnel dans son environnement territorial.',
  },
];

export default function PublicAboutPage() {
  return (
    <PublicLayout>
      <div className="af-about">
        <nav className="af-about-breadcrumb" aria-label="Fil d’Ariane">
          <a href="/">Accueil</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Qui sommes-nous ?</span>
        </nav>

        <section className="af-about-hero" aria-labelledby="af-about-title">
          <div className="af-about-hero-content">
            <p className="af-overline">À propos d’ApprentiFR</p>
            <h1 id="af-about-title">
              Mieux comprendre <span>l’apprentissage</span>, territoire par territoire.
            </h1>
            <p className="af-about-lead">
              ApprentiFR est un projet d’observation et de lecture des données sur
              l’apprentissage en France. Notre ambition : rendre les évolutions des
              métiers et des territoires plus faciles à comprendre, sans réduire
              une réalité complexe à une seule couleur ou à un chiffre.
            </p>
            <a className="af-about-text-link" href="/#carte">
              Explorer les territoires <span aria-hidden="true">↗</span>
            </a>
          </div>

          <aside className="af-about-visual" aria-label="La démarche ApprentiFR">
            <span className="af-about-visual-eyebrow">Notre fil conducteur</span>
            <div className="af-about-visual-statement">Des données.<br />Du contexte.<br /><strong>Une lecture claire.</strong></div>
            <div className="af-about-visual-rule" aria-hidden="true" />
            <p>Observer les signaux du marché sans prétendre prédire le parcours de chacun.</p>
            <span className="af-about-visual-signature">ApprentiFR · Observatoire de l’apprentissage</span>
          </aside>
        </section>

        <section className="af-about-why" aria-labelledby="af-about-why-title">
          <div>
            <p className="af-overline">Pourquoi ce projet ?</p>
            <h2 id="af-about-why-title">Un marché de l’apprentissage qui ne se résume pas à un nombre d’offres.</h2>
          </div>
          <div className="af-about-prose">
            <p>
              Derrière une offre d’apprentissage, il y a un métier, une entreprise,
              un territoire et un contexte qui évoluent. Le nombre d’annonces
              visibles, à lui seul, ne suffit pas à décrire toutes les possibilités.
            </p>
            <p>
              ApprentiFR propose de rapprocher plusieurs indicateurs pour apporter
              des repères plus nuancés. Il s’agit d’éclairer une situation observée,
              pas de décider à la place des jeunes, des familles ou des professionnels.
            </p>
          </div>
        </section>

        <section className="af-about-approach" aria-labelledby="af-about-approach-title">
          <div className="af-about-approach-heading">
            <p className="af-overline">Notre démarche</p>
            <h2 id="af-about-approach-title">Observer, contextualiser, expliquer.</h2>
            <p>Les données sont un point de départ pour comprendre le terrain, jamais un verdict.</p>
          </div>
          <ol className="af-about-steps">
            {workingPrinciples.map(step => (
              <li key={step.number}>
                <span className="af-about-step-number" aria-hidden="true">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="af-about-audiences" aria-labelledby="af-about-audiences-title">
          <div className="af-about-section-heading">
            <p className="af-overline">Pour qui ?</p>
            <h2 id="af-about-audiences-title">Des repères accessibles à chacun.</h2>
            <p>ApprentiFR s’adresse à toutes les personnes qui souhaitent mieux lire l’environnement de l’apprentissage.</p>
          </div>
          <div className="af-about-audience-list">
            {audiences.map((audience, index) => (
              <article className="af-about-audience" key={audience.title}>
                <span className="af-about-audience-number" aria-hidden="true">0{index + 1}</span>
                <h3>{audience.title}</h3>
                <p>{audience.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="af-about-transparency" aria-labelledby="af-about-transparency-title">
          <div className="af-about-transparency-intro">
            <p className="af-overline">Transparence & prudence</p>
            <h2 id="af-about-transparency-title">Ce que les données permettent de dire. Et ce qu’elles ne disent pas.</h2>
          </div>
          <div className="af-about-transparency-columns">
            <div>
              <h3>Ce que nous cherchons à montrer</h3>
              <p>
                Les offres observées, leur répartition, les écarts territoriaux et,
                lorsque les données le permettent, les évolutions dans le temps.
              </p>
              <p>
                Les indicateurs reposent notamment sur les informations disponibles
                auprès de La Bonne Alternance et sur des références statistiques
                publiques comme celles de l’INSEE.
              </p>
            </div>
            <div>
              <h3>Ce qu’il faut garder à l’esprit</h3>
              <p>
                Une offre observée ne garantit pas un recrutement. Une période
                moins favorable n’interdit pas de réussir son projet, et une
                absence de données ne signifie pas que la situation est favorable.
              </p>
              <p>
                ApprentiFR n’est pas un service officiel de l’État : ses vigilances
                constituent des indicateurs d’observation, pas des décisions
                administratives ni des prévisions individuelles.
              </p>
            </div>
          </div>
        </section>

        <section className="af-about-conclusion" aria-labelledby="af-about-conclusion-title">
          <div>
            <p className="af-overline">Aller plus loin</p>
            <h2 id="af-about-conclusion-title">Des données à explorer, des tendances à comprendre.</h2>
            <p>Commencez par un territoire, puis affinez votre découverte par métier ou par secteur.</p>
          </div>
          <div className="af-about-actions">
            <a href="/#carte" className="af-about-action-primary">Explorer la carte <span aria-hidden="true">→</span></a>
            <a href="/metiers" className="af-about-action-secondary">Découvrir les métiers <span aria-hidden="true">↗</span></a>
            <a href="/articles" className="af-about-action-secondary">Lire nos analyses <span aria-hidden="true">↗</span></a>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
