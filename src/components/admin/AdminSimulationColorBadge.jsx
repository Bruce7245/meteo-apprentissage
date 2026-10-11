import React from 'react';
import {getAdminSimulationColor} from '../../utils/adminSimulationColors.mjs';
import './AdminSimulationColorBadge.css';

export default function AdminSimulationColorBadge({score,compact=false}) {
  const color = getAdminSimulationColor(score);
  return (
    <span
      className={'admin-simulation-color-badge admin-simulation-color--'+color.key +
        (compact ? ' admin-simulation-color-badge--compact' : '')}
      title={color.detail || color.meaning}
      aria-label={'Couleur de simulation : '+color.label+'. '+color.detail}
    >
      <span className="admin-simulation-color-dot" aria-hidden="true"/>
      <span>{color.label}</span>
      {!compact && <small>{color.basis==='density_only'?'densité seule':'simulation'}</small>}
    </span>
  );
}
