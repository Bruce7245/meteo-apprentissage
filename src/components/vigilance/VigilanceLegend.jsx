import React from 'react';
import VigilanceBadge from './VigilanceBadge.jsx';

const levels = [
  'green',
  'yellow',
  'orange',
  'red',
  'insufficient_data',
];

export default function VigilanceLegend() {
  return (
    <section className="panel compact-panel">
      <h2>Légende</h2>
      <div className="legend-row">
        {levels.map((level) => (
          <VigilanceBadge key={level} level={level} />
        ))}
      </div>
    </section>
  );
}
