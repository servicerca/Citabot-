import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

console.log('CitaBot agenda usability, pagination and onboarding: OK');
