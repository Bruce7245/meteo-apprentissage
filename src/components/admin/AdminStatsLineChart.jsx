import React from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default function AdminStatsLineChart({
  points = [],
  observedKey = 'totalObservedOffers',
  expectedKey = 'totalExpectedOffers',
  ratioKey = null,
  height = 290,
}) {
  const labels = points.map((point) => point.date || '');

  const datasets = [
    {
      label: 'Offres observées',
      data: points.map((point) => finite(point?.[observedKey])),
      borderColor: '#245f85',
      backgroundColor: 'rgba(36, 95, 133, 0.08)',
      pointRadius: 2.5,
      pointHoverRadius: 5,
      tension: 0.3,
      fill: false,
      spanGaps: true,
    },
    {
      label: 'Offres attendues',
      data: points.map((point) => finite(point?.[expectedKey])),
      borderColor: '#8a6b25',
      backgroundColor: 'rgba(138, 107, 37, 0.08)',
      borderDash: [6, 5],
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.3,
      fill: false,
      spanGaps: true,
    },
  ];

  if (ratioKey) {
    datasets.push({
      label: 'Ratio observé / attendu (%)',
      data: points.map((point) => {
        const ratio = finite(point?.[ratioKey]);
        return ratio === null ? null : ratio * 100;
      }),
      borderColor: '#577386',
      backgroundColor: 'rgba(87, 115, 134, 0.06)',
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.3,
      fill: false,
      spanGaps: true,
      yAxisID: 'ratio',
    });
  }

  const data = {
    labels,
    datasets,
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          padding: 18,
        },
      },
      tooltip: {
        callbacks: {
          title(items) {
            return items?.[0]?.label || '';
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(148, 163, 184, 0.15)',
        },
        ticks: {
          precision: 0,
        },
      },
      ...(ratioKey
        ? {
            ratio: {
              position: 'right',
              beginAtZero: true,
              grid: {
                drawOnChartArea: false,
              },
              ticks: {
                callback(value) {
                  return value + ' %';
                },
              },
            },
          }
        : {}),
    },
  };

  return (
    <div className="admin-stats-chart-canvas" style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
}
