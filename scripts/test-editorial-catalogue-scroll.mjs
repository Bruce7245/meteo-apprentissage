import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/pages/admin/AdminOccupationOffersPage.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/pages/admin/AdminOccupationOffersPage.jsx', import.meta.url), 'utf8');

function rules(selector) {
  const escaped = selector.replaceAll('.', '\\.');
  const expression = new RegExp(escaped + '\\s*\\{([^{}]*)\\}', 'g');
  return [...css.matchAll(expression)].map(match => match[1]);
}

test('catalogue has a height-constrained flex column instead of intrinsic grid tracks', () => {
  const container = rules('.editorial-catalogue')[0];
  assert.ok(container, 'missing catalogue CSS');
  assert.match(container, /display\s*:\s*flex/);
  assert.match(container, /flex-direction\s*:\s*column/);
  assert.match(container, /max-height\s*:\s*calc\(100dvh\s*-\s*32px\)/);
});

test('the list shrinks and scrolls independently without shrinking its buttons', () => {
  const list = rules('.editorial-catalogue-list')[0];
  assert.ok(list, 'missing list CSS');
  assert.match(list, /flex\s*:\s*1\s+1\s+auto/);
  assert.match(list, /min-height\s*:\s*0/);
  assert.match(list, /overflow-y\s*:\s*auto/);
  assert.match(list, /scrollbar-gutter\s*:\s*stable/);
  const button = rules('.editorial-catalogue-item')[0];
  assert.match(button, /flex\s*:\s*0\s+0\s+auto/);
});

test('tablet and mobile lists have bounded scrolling', () => {
  const tabletCss = css.slice(css.indexOf('@media(max-width:1050px)'));
  assert.match(tabletCss, /\.editorial-catalogue-list\s*\{flex:0 1 auto;max-height:310px\}/);
  assert.match(tabletCss, /\.editorial-catalogue-list\s*\{max-height:270px\}/);
});

test('the scrollable list is named and keyboard focusable', () => {
  assert.match(jsx, /className="editorial-catalogue-list" role="region"/);
  assert.match(jsx, /tabIndex=\{catalogueRows\.length\?0:-1\}/);
  assert.match(jsx, /editorial-catalogue-scroll-hint/);
});
