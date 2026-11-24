import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const navStart = html.indexOf('<nav class="nav"');
const navEnd = html.indexOf('</nav>', navStart);
assert.ok(navStart >= 0 && navEnd > navStart, 'Debe existir una navegación principal delimitable.');
const nav = html.slice(navStart, navEnd + '</nav>'.length);

for (const [view, label] of [
  ['dashboard', 'Inicio'],
  ['agenda', 'Agenda'],
  ['clients', 'Clientes'],
  ['conversations', 'Mensajes'],
]) {
  assert.match(nav, new RegExp('data-view="' + view + '"'));
  assert.ok(nav.includes('>' + label + '</span>'), 'Debe conservarse el acceso principal ' + label + '.');
}

assert.match(nav, /aria-label="Navegación principal"/);
assert.match(nav, /id="navMoreToggle"[^>]*aria-expanded="false"[^>]*aria-controls="navMoreMenu"/);
assert.match(nav, /id="navMoreMenu"[^>]*aria-label="Más opciones"/);
for (const view of ['revenue', 'ai', 'marketing', 'reports', 'settings', 'platform-admin']) {
  assert.ok(nav.includes('data-view="' + view + '"'), 'La opción ' + view + ' debe seguir disponible en Más.');
}
assert.match(nav, /class="nav-logout"[^>]*onclick="logout\(\)"/);

const mappedViews = [...nav.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
for (const view of mappedViews) {
  assert.ok(html.includes('id="view-' + view + '"'), 'Cada acceso debe tener su vista: ' + view + '.');
}
assert.ok(mappedViews.length >= 10, 'No deben desaparecer vistas existentes al simplificar el menú.');

assert.match(html, /\.nav-more-menu\.open\s*\{display:grid\}/);
assert.match(html, /navMoreToggle\?\.addEventListener\("click"/);
assert.match(html, /event\.key==="Escape"&&navMoreMenu\?\.classList\.contains\("open"\)/);
assert.match(html, /if\(wrap&&!wrap\.contains\(event\.target\)\)closeMoreMenu\(\)/);
assert.match(html, /if\(moreToggle\)\{[\s\S]*?setAttribute\("aria-expanded","false"\)/);

assert.match(html, /@media\(max-width:700px\)\{[\s\S]*?\.nav\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\);grid-template-rows:1fr/);
assert.match(html, /<style id="citabot-tablet-navigation">[\s\S]*?@media \(min-width:701px\) and \(max-width:1050px\)/);
assert.match(html, /\.app\{grid-template-columns:210px minmax\(0,1fr\)\}/);
assert.match(html, /\.nav button span:last-child\{white-space:normal;overflow:visible/);

assert.match(html, /<\/style>\s*<style id="citabot-tablet-navigation">[\s\S]*?<\/style>\s*<\/head>/,
  'Los estilos de tablet deben ser bloques hermanos válidos, no etiquetas style anidadas.');

console.log('CitaBot simple navigation and responsive breakpoints: OK');
