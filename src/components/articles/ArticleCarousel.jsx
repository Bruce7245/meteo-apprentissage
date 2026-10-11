import React, { Children, useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Carrousel éditorial accessible : défilement horizontal natif, scroll-snap,
 * contrôles précédent/suivant et aucun défilement automatique.
 */
export default function ArticleCarousel({ children, label = 'Articles ApprentiFR' }) {
  const slides = Children.toArray(children);
  const trackRef = useRef(null);
  const id = useId();
  const [position, setPosition] = useState({
    previous: false,
    next: false,
    current: 1,
  });

  const updatePosition = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const cards = [...track.children];
    let current = 1;
    if (cards.length) {
      const nearestIndex = cards.reduce((best, card, index) => (
        Math.abs(card.offsetLeft - track.scrollLeft)
          < Math.abs(cards[best].offsetLeft - track.offsetLeft - track.scrollLeft)
          ? index : best
      ), 0);
      current = nearestIndex + 1;
    }
    const nextPosition = {
      previous: track.scrollLeft > 2,
      next: track.scrollLeft < maxScroll - 2,
      current,
    };
    setPosition(previous => (
      previous.previous === nextPosition.previous
      && previous.next === nextPosition.next
      && previous.current === nextPosition.current
        ? previous : nextPosition
    ));
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    updatePosition();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updatePosition)
      : null;
    observer?.observe(track);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [slides.length, updatePosition]);

  function move(direction) {
    const track = trackRef.current;
    const first = track?.firstElementChild;
    if (!track || !first) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const distance = first.getBoundingClientRect().width + gap;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({
      left: direction * distance,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }

  function handleKeyDown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
  }

  if (!slides.length) return null;

  return (
    <div className="af-article-carousel" role="region" aria-roledescription="carrousel" aria-label={label}>
      <div className="af-article-carousel-controls">
        <span className="af-article-carousel-count" aria-live="polite" aria-atomic="true">
          {position.current} / {slides.length}
        </span>
        <button
          type="button"
          className="af-carousel-arrow"
          onClick={() => move(-1)}
          disabled={!position.previous}
          aria-controls={id}
          aria-label="Article précédent"
        >
          <span aria-hidden="true">←</span>
        </button>
        <button
          type="button"
          className="af-carousel-arrow"
          onClick={() => move(1)}
          disabled={!position.next}
          aria-controls={id}
          aria-label="Article suivant"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div
        className="af-article-carousel-track"
        id={id}
        ref={trackRef}
        tabIndex={0}
        onScroll={updatePosition}
        onKeyDown={handleKeyDown}
        aria-label="Faites défiler les cartes horizontalement"
      >
        {slides.map((slide, index) => (
          <div
            className="af-article-carousel-slide"
            role="group"
            aria-roledescription="diapositive"
            aria-label={`${index + 1} sur ${slides.length}`}
            key={slide.key || index}
          >
            {slide}
          </div>
        ))}
      </div>
    </div>
  );
}
