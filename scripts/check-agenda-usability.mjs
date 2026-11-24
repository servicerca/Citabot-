import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const agendaStart = html.indexOf('function cbRenderAgenda()');
const agendaEnd = html.indexOf('window.updateAppointmentStatus=', agendaStart);
assert.ok(agendaStart >= 0 && agendaEnd > agendaStart, 'La vista Agenda debe poder delimitarse junto a su manejador de estado.');
const agenda = html.slice(agendaStart, agendaEnd);

assert.match(agenda, /const pageSize=25/);
assert.match(agenda, /id="agendaSearch"/);
assert.match(agenda, /label for="agendaSearch"/);
assert.match(agenda, /id="agendaPeriod"/);
assert.match(agenda, /label for="agendaPeriod"/);
assert.match(agenda, /id="agendaStatus"/);
assert.match(agenda, /label for="agendaStatus"/);
assert.match(agenda, /value="upcoming"/);
assert.match(agenda, /value="today"/);
assert.match(agenda, /value="all"/);
assert.match(agenda, /appointment\.customers\?\.name/);
assert.match(agenda, /appointment\.services\?\.name/);
assert.match(agenda, /appointment\.staff\?\.name/);
assert.match(agenda, /rows\.sort\(/);
assert.match(agenda, /aria-live="polite"/);
assert.match(agenda, /window\.filterAgenda=/);
assert.match(agenda, /window\.changeAgendaPage=/);
assert.doesNotMatch(agenda, /\.slice\(\s*0\s*,\s*100\s*\)/,
  'La Agenda no debe truncar silenciosamente las citas a las primeras 100.');

assert.match(html, /window\.updateAppointmentStatus=async/);
assert.match(html, /Tu negocio está casi listo\./);
assert.doesNotMatch(html, /Tu cuenta está creada\.<\/h1>/,
  'El paso final no debe decir que la cuenta acaba de crearse, porque ya existe antes de crear el negocio.');

for (const id of ['obName', 'obCity', 'obPhone']) {
  assert.match(html, new RegExp('for="' + id + '"'));
}


assert.match(agenda, /if\(aUpcoming!==bUpcoming\)return aUpcoming\?-1:1/);
assert.match(agenda, /return aUpcoming\?aTime-bTime:bTime-aTime/);

// Execute the actual Agenda renderer in a minimal DOM harness to verify paging and filters.
const agendaElements = {
  agendaSearch: { value: '' },
  agendaPeriod: { value: 'upcoming' },
  agendaStatus: { value: '' },
  agendaRows: { innerHTML: '' },
  agendaCount: { textContent: '' },
  agendaPagination: { innerHTML: '' },
};
const fakeSection = { innerHTML: '' };
const makeAppointment = (id, startsAt, customer, status = 'confirmed') => ({
  id,
  starts_at: new Date(startsAt).toISOString(),
  status,
  payment_method: 'cash',
  customers: { name: customer, phone: '+573000000000' },
  services: { name: 'Corte' },
  staff: { name: 'Profesional' },
});
const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const appointments = [
  ...Array.from({ length: 40 }, (_, i) => makeAppointment(
    'future-' + (i + 1),
    now + (i + 1) * day,
    'UPCOMING_' + String(i + 1).padStart(3, '0')
  )),
  ...Array.from({ length: 110 }, (_, i) => makeAppointment(
    'past-' + (i + 1),
    now - (i + 1) * day,
    'PAST_' + String(i + 1).padStart(3, '0'),
    'completed'
  )),
  makeAppointment('today-test', now + 60 * 60 * 1000, 'TODAY_APPOINTMENT'),
  makeAppointment('no-show-test', now + 2 * day, 'NO_SHOW_APPOINTMENT', 'no_show'),
];
const fakeWindow = {};
const fakeDocument = {
  querySelector(selector) {
    return selector === '#view-agenda' ? fakeSection : null;
  },
  getElementById(id) {
    return agendaElements[id] || null;
  },
};
runInNewContext(agenda + '\ncbRenderAgenda();', {
  document: fakeDocument,
  window: fakeWindow,
  currentData: { appointments, services: [] },
  currentBusiness: { timezone: 'UTC' },
  esc: value => String(value ?? '').replace(/[&<>"]/g, ''),
  cbMoney: value => String(value ?? 0),
  cbPaymentLabel: value => value === 'cash' ? 'Efectivo' : '—',
  Intl,
  Date,
  Number,
  Math,
});

const countRows = () => (agendaElements.agendaRows.innerHTML.match(/<tr>/g) || []).length;
assert.equal(countRows(), 25, 'La Agenda debe mostrar 25 citas por página.');
assert.match(agendaElements.agendaCount.textContent, /de 41 cita\(s\)/,
  'El filtro Próximas debe excluir el historial y los estados cancelados/no asistió.');
fakeWindow.changeAgendaPage(2);
assert.equal(countRows(), 16, 'La segunda página debe mostrar las 16 citas restantes.');
assert.match(agendaElements.agendaRows.innerHTML, /UPCOMING_026/);
assert.doesNotMatch(agendaElements.agendaRows.innerHTML, /PAST_001/);

agendaElements.agendaPeriod.value = 'today';
fakeWindow.filterAgenda();
assert.equal(countRows(), 1, 'El filtro Hoy debe devolver solo la cita de hoy.');
assert.match(agendaElements.agendaRows.innerHTML, /TODAY_APPOINTMENT/);

agendaElements.agendaPeriod.value = 'upcoming';
agendaElements.agendaStatus.value = 'no_show';
fakeWindow.filterAgenda();
assert.equal(countRows(), 1, 'El filtro de estado debe poder mostrar citas no asistidas por separado.');
assert.match(agendaElements.agendaRows.innerHTML, /NO_SHOW_APPOINTMENT/);

agendaElements.agendaStatus.value = '';
agendaElements.agendaSearch.value = 'UPCOMING_020';
fakeWindow.filterAgenda();
assert.equal(countRows(), 1, 'La búsqueda debe filtrar por nombre de cliente.');
assert.match(agendaElements.agendaRows.innerHTML, /UPCOMING_020/);

agendaElements.agendaSearch.value = '';
agendaElements.agendaPeriod.value = 'all';
fakeWindow.filterAgenda();
assert.match(agendaElements.agendaCount.textContent, /de 152 cita\(s\)/);
assert.match(agendaElements.agendaRows.innerHTML, /TODAY_APPOINTMENT/,
  'El resultado completo debe priorizar citas futuras próximas antes del historial.');
fakeWindow.changeAgendaPage(2);
assert.ok(
  agendaElements.agendaRows.innerHTML.indexOf('UPCOMING_040') < agendaElements.agendaRows.innerHTML.indexOf('PAST_001'),
  'Las próximas citas deben preceder al historial en la vista completa.'
);
assert.ok(
  agendaElements.agendaRows.innerHTML.indexOf('PAST_001') < agendaElements.agendaRows.innerHTML.indexOf('PAST_002'),
  'El historial debe quedar ordenado de la cita pasada más reciente a la más antigua.'
);

console.log('CitaBot agenda usability, pagination and onboarding: OK');
