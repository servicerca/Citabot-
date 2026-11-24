import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const goStart = html.indexOf('function go(');
const goEnd = html.indexOf('\ndocument.querySelectorAll(".nav button[data-view]")', goStart);
const goSource = goStart >= 0 && goEnd > goStart ? html.slice(goStart, goEnd) : '';

assert.ok(goSource, 'La función global go debe existir y poder delimitarse completa.');
assert.match(goSource, /window\.cbIsPlatformAdmin\?\.\(\)!==true/,
  'La ruta administrativa debe denegar por defecto si no se confirma el rol.');
assert.match(goSource, /window\.cbIsPlatformAdmin\?\.\(\)===true/,
  'La carga del panel requiere confirmación explícita del rol administrativo.');
assert.doesNotMatch(goSource, /\bisPlatformAdmin\b/,
  'La función global go no debe referenciar directamente una variable privada de la IIFE.');
assert.match(html, /window\.cbIsPlatformAdmin\s*=\s*\(\)\s*=>\s*isPlatformAdmin;/,
  'Debe existir un getter que consulte el estado administrativo real de la sesión.');
assert.match(html, /window\.cbLoadPlatformAdminPanel\s*=\s*\(\)\s*=>\s*cbLoadPlatformAdminPanel\(\);/,
  'El panel privado debe publicarse mediante una entrada namespaced para la navegación global.');
assert.match(html, /onclick="window\.cbLoadPlatformAdminPanel\?\.\(\)"/,
  'El botón de actualizar debe usar la entrada global y no una función privada de la IIFE.');
assert.doesNotMatch(goSource, /void cbLoadPlatformAdminPanel\(/,
  'La navegación global no debe llamar una función privada fuera de su ámbito.');
assert.match(html, /async function cbLoadPlatformAdmin\(userId\)/,
  'Debe conservarse la consulta de rol en el arranque autenticado.');
assert.match(html, /from\('platform_admins'\)\.select\('user_id'\)/,
  'El rol debe seguir consultándose en la tabla de administración.');

console.log('CitaBot platform-admin navigation scope: OK');
