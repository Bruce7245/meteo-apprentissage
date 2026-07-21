import React from 'react';
import { getLevelCss, getLevelLabel } from '../../utils/levelUtils.js';

export default function VigilanceBadge({ level = 'green' }) {
  return (
    <span className={`vigilance-badge vigilance-${getLevelCss(level)}`}>
      {getLevelLabel(level)}
    </span>
  );
}
