import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const settingsStart = html.indexOf('function cbRenderSettings()');
const settingsEnd = html.indexOf('window.toggleBusinessHourFields=', settingsStart);
assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, 'La vista Configuración debe tener un renderizador identificable.');
const settings = html.slice(settingsStart, settingsEnd);

assert.match(settings, /const toggleLabel=open\?'Abierto':configured\?'Cerrado':'Configurar horario'/,
  'El estado cerrado no debe etiquetarse incorrectamente como Abierto.');
assert.match(settings, /data-hour-label=/);
assert.match(settings, /onchange="toggleBusinessHourFields\(/);
assert.match(settings, /id="business-hour-open-time-/);
assert.match(settings, /id="business-hour-close-time-/);
assert.match(settings, /label for="setBusiness"/);
assert.match(settings, /label for="setCity"/);
assert.match(settings, /label for="setAddress"/);
assert.match(settings, /label for="setPhone"/);
assert.match(html, /\.business-hour-row\{[^}]*grid-template-columns:minmax\(95px,1\.1fr\)/);
assert.match(html, /@media\(max-width:800px\)\{\s*\.business-hour-row\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
assert.match(html, /@media\(max-width:420px\)\{/);

const toggleStart=html.indexOf('window.toggleBusinessHourFields=');
const toggleEnd=html.indexOf('window.captureBusinessLocation=',toggleStart);
assert.ok(toggleStart>=0&&toggleEnd>toggleStart,'El controlador de horario debe poder aislarse.');
const toggleCode=html.slice(toggleStart,toggleEnd);
const opening={disabled:true},closing={disabled:true},label={textContent:'Cerrado'};
const elements={
  '[data-hour-open-time="1"]':opening,
  '[data-hour-close-time="1"]':closing,
  '[data-hour-label="1"]':label,
};
const document={querySelector:selector=>elements[selector]||null};
const window={};
runInNewContext(toggleCode,{window,document});
window.toggleBusinessHourFields(1,true);
assert.equal(opening.disabled,false);
assert.equal(closing.disabled,false);
assert.equal(label.textContent,'Abierto');
window.toggleBusinessHourFields(1,false);
assert.equal(opening.disabled,true);
assert.equal(closing.disabled,true);
assert.equal(label.textContent,'Cerrado');

console.log('CitaBot responsive business hours and accessible settings: OK');
