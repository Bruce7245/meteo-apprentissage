import React, { useMemo } from 'react';
import { FiArrowUp, FiArrowDown } from 'react-icons/fi';
import {
  Badge,
  Box,
  Card,
  Span,
  Stack,
  Stat,
} from '@chakra-ui/react';

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(Number(value));
}

function Sparkline({ values = [], direction = 'neutral' }) {
  const points = useMemo(() => {
    const usable = values.map(Number).filter(Number.isFinite);

    if (usable.length < 2) return '';

    const width = 112;
    const height = 48;
    const padding = 3;
    const min = Math.min(...usable);
    const max = Math.max(...usable);
    const range = max - min || 1;

    return usable
      .map((value, index) => {
        const x = padding + (index / (usable.length - 1)) * (width - padding * 2);
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values]);

  if (!points) return null;

  return (
    <Box className={`kpi-sparkline kpi-sparkline-${direction}`} aria-hidden="true">
      <svg viewBox="0 0 112 48" preserveAspectRatio="none">
        <polyline points={points} />
      </svg>
    </Box>
  );
}

export default function DepartmentKpiCard({
  label,
  value,
  detail,
  history = [],
  trend = null,
  trendLabel = 'sur la période',
}) {
  const numericTrend = trend === null || trend === undefined
    ? null
    : Number(trend);

  const direction = numericTrend > 0
    ? 'up'
    : numericTrend < 0
      ? 'down'
      : 'neutral';

  const formattedTrend = formatPercent(numericTrend);

  return (
    <Card.Root className="department-kpi-card" size="sm">
      <Card.Body className="department-kpi-card-body">
        <Stack gap="1" flex="1" minW="0">
          <Box
            fontWeight="semibold"
            textStyle="sm"
            color="fg.muted"
          >
            {label}
          </Box>

          <Stat.Root size="lg">
            <Span className="department-kpi-value">{value}</Span>
          </Stat.Root>

          <Box textStyle="xs" color="fg.muted">
            {detail}
          </Box>

          {formattedTrend ? (
            <Badge
              alignSelf="flex-start"
              colorPalette={direction === 'up' ? 'green' : direction === 'down' ? 'red' : 'gray'}
              variant="subtle"
              gap="1"
              className="department-kpi-trend"
            >
              {direction === 'up' ? <FiArrowUp aria-hidden="true" /> : null}
              {direction === 'down' ? <FiArrowDown aria-hidden="true" /> : null}
              {formattedTrend} {trendLabel}
            </Badge>
          ) : history.length > 0 ? (
            <Span className="department-kpi-history-note">
              Historique en constitution
            </Span>
          ) : null}
        </Stack>

        <Sparkline values={history} direction={direction} />
      </Card.Body>
    </Card.Root>
  );
}
