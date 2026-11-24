import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = html.indexOf('function cbGetAppointmentPrerequisites()');
const openStart = html.indexOf('window.openModal=type=>{', helperStart);
const end = html.indexOf('window.confirmModal=', openStart);
assert.ok(helperStart >= 0 && openStart > helperStart && end > openStart,
  'El helper y el modal de Nueva cita deben poder delimitarse.');

const source = html.slice(helperStart, end);
assert.match(source, /if\(!\(currentData\.customers\|\|\[\]\)\.length\)/);
assert.match(source, /type:'Nuevo cliente'/);
assert.match(source, /type:'Nuevo servicio'/);
assert.match(source, /type:'Nuevo profesional'/);
assert.match(source, /const missing=cbGetAppointmentPrerequisites\(\)/);
assert.match(source, /Antes de crear una cita, completa estos pasos/);
assert.match(source, /Guarda cada elemento y vuelve a pulsar “Nueva cita”/);
assert.match(source, /openModal\(\\'/);

for (const id of ['mCustomer','mService','mStaff','mPaymentMethod','mStart','mNote']) {
  assert.match(source, new RegExp('for="' + id + '"'),
    'El campo ' + id + ' debe tener una etiqueta vinculada.');
}
assert.match(html, /\.appointment-prerequisite\{[^}]*grid-template-columns/);
assert.match(html, /@media\(max-width:480px\)\{\.appointment-prerequisite/);

const elements = {
  modalBody: { innerHTML: '' },
  modalTitle: { textContent: '' },
  modalDesc: { textContent: '' },
  modal: { classList: { added: [], add(value){ this.added.push(value); } } },
};
const $ = id => elements[id] || null;
const state = { modalType: '' };
const window = {};
const context = {
  currentData: { customers: [], services: [], staff: [] },
  state, window, $, esc: value => String(value ?? '').replace(/[&<>"]/g, ''),
  cbMoney: value => '$' + String(value ?? 0),
  String, Number, Boolean, Array, Map,
};
runInNewContext(source, context);
window.openModal('Nueva cita');
assert.match(elements.modalBody.innerHTML, /Añadir un cliente/);
assert.match(elements.modalBody.innerHTML, /Añadir un servicio/);
assert.match(elements.modalBody.innerHTML, /Añadir un profesional/);
assert.match(elements.modalBody.innerHTML, /openModal\('Nuevo cliente'\)/);
assert.match(elements.modalBody.innerHTML, /openModal\('Nuevo servicio'\)/);
assert.match(elements.modalBody.innerHTML, /openModal\('Nuevo profesional'\)/);
assert.match(elements.modalDesc.textContent, /Antes de crear una cita/);
assert.ok(elements.modal.classList.added.includes('open'));

context.currentData = {
  customers: [{id:'c1',name:'Ana',phone:'300'}],
  services: [{id:'s1',name:'Corte',price:25000,active:true}],
  staff: [],
};
elements.modalBody.innerHTML = '';
window.openModal('Nueva cita');
assert.match(elements.modalBody.innerHTML, /Añadir un profesional/);
assert.doesNotMatch(elements.modalBody.innerHTML, /Añadir un cliente/);
assert.doesNotMatch(elements.modalBody.innerHTML, /Añadir un servicio/);

context.currentData.staff = [{id:'p1',name:'Profesional',active:true}];
elements.modalBody.innerHTML = '';
window.openModal('Nueva cita');
assert.match(elements.modalBody.innerHTML, /id="mCustomer"/);
assert.match(elements.modalBody.innerHTML, /id="mService"/);
assert.match(elements.modalBody.innerHTML, /id="mStaff"/);
assert.doesNotMatch(elements.modalBody.innerHTML, /appointment-prerequisites/);

console.log('CitaBot first-appointment guidance and accessible form labels: OK');
