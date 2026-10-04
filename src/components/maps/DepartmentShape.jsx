import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import franceDepartments from '@svg-maps/france.departments';
import { getLevelCss } from '../../utils/levelUtils.js';

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export default function DepartmentShape({
  code,
  level = 'green',
  label,
}) {
  const pathRef = useRef(null);
  const [viewBox, setViewBox] = useState(franceDepartments.viewBox);
  const normalizedCode = normalizeCode(code);

  const location = useMemo(() => {
    return franceDepartments.locations.find(
      (item) => normalizeCode(item.id) === normalizedCode
    ) || null;
  }, [normalizedCode]);

  useLayoutEffect(() => {
    if (!pathRef.current || !location) return;

    try {
      const box = pathRef.current.getBBox();
      const padding = Math.max(box.width, box.height) * 0.1;

      setViewBox([
        box.x - padding,
        box.y - padding,
        box.width + padding * 2,
        box.height + padding * 2,
      ].join(' '));
    } catch {
      setViewBox(franceDepartments.viewBox);
    }
  }, [location]);

  if (!location) {
    return (
      <div
        className={`department-shape department-shape-fallback department-shape-${getLevelCss(level)}`}
        aria-label={label || `Département ${normalizedCode}`}
      >
        <strong>{normalizedCode}</strong>
      </div>
    );
  }

  return (
    <div
      className={`department-shape department-shape-${getLevelCss(level)}`}
      aria-label={label || location.name}
    >
      <svg
        className="department-shape-svg"
        viewBox={viewBox}
        role="img"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid meet"
      >
        <path ref={pathRef} d={location.path} />
      </svg>
    </div>
  );
}
