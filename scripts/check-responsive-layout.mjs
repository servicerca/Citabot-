import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(html, /id="mobileMenuToggle"/, 'El menú móvil debe tener un control visible.');
assert.match(html, /id="primaryNavigation"/, 'La navegación debe estar asociada al control móvil.');
assert.match(html, /id="navScrim"/, 'El menú móvil debe disponer de fondo para cerrar.');
assert.match(html, /window\.toggleMobileNav=function\(force\)/, 'El control debe abrir y cerrar el menú.');
assert.match(html, /event\.key==="Escape"/, 'Escape debe cerrar la navegación móvil.');

for (const view of [
  'dashboard', 'agenda', 'clients', 'conversations', 'revenue',
  'ai', 'marketing', 'reports', 'settings'
]) {
  assert.match(
    html,
    new RegExp('data-view="' + view + '"'),
    'No debe desaparecer la opción de navegación: ' + view
  );
}

assert.match(html, /\.hero-preview\s*\{\s*transform:\s*none\s*!important;/);
assert.match(html, /@media \(min-width: 701px\) and \(max-width: 1050px\)/);
assert.match(html, /@media \(max-width: 700px\)/);
assert.match(html, /\.sidebar\.is-open\s*\{\s*transform:\s*translateX\(0\)/);
assert.match(html, /\.sidebar \.nav button span:not\(\.nav-icon\)\s*\{\s*display:\s*block/);
assert.doesNotMatch(
  html,
  /\.hero-preview\s*\{[^}]*transform:\s*rotate\(/,
  'La portada no debe quedar torcida por una rotación decorativa.'
);

console.log('CitaBot responsive layout and complete navigation: OK');
