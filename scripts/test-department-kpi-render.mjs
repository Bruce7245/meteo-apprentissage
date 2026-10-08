import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { createServer } from 'vite';

test('les cartes KPI affichent les variations sans erreur de contexte Stat', async () => {
  const server = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'error',
  });

  try {
    const { default: DepartmentKpiCard } = await server.ssrLoadModule(
      '/src/components/dashboard/DepartmentKpiCard.jsx'
    );

    for (const trend of [0.15, -0.12, 0, null]) {
      const content = React.createElement(DepartmentKpiCard, {
        label: 'Offres observees',
        value: '123',
        detail: 'Indicateur territorial',
        trend,
        trendLabel: 'sur la periode',
        history: [100, 110, 123],
      });
      const html = renderToStaticMarkup(
        React.createElement(ChakraProvider, { value: defaultSystem }, content)
      );

      assert.match(html, /Offres observees/);
      assert.match(html, /Indicateur territorial/);
      assert.match(html, /123/);

      if (trend === 0.15) {
        assert.match(html, /\+15/);
        assert.match(html, /department-kpi-trend/);
      } else if (trend === -0.12) {
        assert.match(html, /[−-]12/);
        assert.match(html, /department-kpi-trend/);
      } else if (trend === 0) {
        assert.match(html, /department-kpi-trend/);
      } else {
        assert.match(html, /department-kpi-history-note/);
      }
    }
  } finally {
    await server.close();
  }
});
