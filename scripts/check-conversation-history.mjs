import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /\.from\(['"]messages['"]\).*\.limit\(200\)/s,
  'No debe existir un límite global de 200 mensajes.');
assert.doesNotMatch(html, /rows\.slice\(-50\)/,
  'El renderizador no debe truncar el historial a 50 mensajes en memoria.');
assert.match(html, /messages!messages_customer_id_fkey!inner/,
  'El índice de conversaciones debe traer un mensaje reciente por cliente.');
assert.match(html, /\.eq\(['"]messages\.business_id['"],bid\)/,
  'La consulta de previsualizaciones debe limitar mensajes al negocio.');
assert.match(html, /\.limit\(1,\{referencedTable:'messages'\}\)/,
  'Cada cliente debe devolver solo su mensaje más reciente.');
assert.match(html, /cbFetchAllPages\(\(from,to\)=>sb\.from\(['"]customers['"]\)/,
  'La lista de conversaciones debe paginar clientes y no traer todo el historial.');

const start = html.indexOf('const CONVERSATION_HISTORY_PAGE_SIZE=50;');
const end = html.indexOf('function cbRenderConversations()', start);
assert.ok(start >= 0 && end > start, 'Debe existir un estado y cargador de historial delimitables.');
const source = html.slice(start, end);
assert.match(source, /\.eq\(['"]business_id['"],businessId\)/);
assert.match(source, /\.eq\(['"]customer_id['"],customerId\)/);
assert.match(source, /\.order\(['"]created_at['"],\{ascending:false\}\)/);
assert.match(source, /\.order\(['"]id['"],\{ascending:false\}\)/);
assert.match(source, /\.limit\(CONVERSATION_HISTORY_PAGE_SIZE\+1\)/);
assert.match(source, /query\.or\(cbMessageCursorFilter\(conversationHistory\.cursor\)\)/);
assert.match(source, /requestId!==conversationHistory\.requestId/);
assert.match(source, /messages\.scrollHeight-previousHeight\+previousTop/);

const calls = [];
let databaseRows = [];
class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = {};
    this.orders = [];
    this.pageLimit = null;
    this.cursorFilter = null;
  }
  select() { return this; }
  eq(column, value) { this.filters[column] = value; return this; }
  order(column, options) { this.orders.push({ column, options }); return this; }
  limit(value) { this.pageLimit = value; return this; }
  or(value) { this.cursorFilter = value; return this; }
  then(resolve, reject) {
    const filters = { ...this.filters };
    const orders = this.orders.slice();
    const limit = this.pageLimit;
    const cursorFilter = this.cursorFilter;
    const call = { table: this.table, filters, orders, limit, cursorFilter };
    calls.push(call);
    let rows = databaseRows.filter(row =>
      row.business_id === filters.business_id &&
      row.customer_id === filters.customer_id
    );
    if (cursorFilter) {
      const match = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([0-9a-f-]+)\)$/i.exec(cursorFilter);
      assert.ok(match, 'El cursor debe expresar created_at menor o igualdad con id menor.');
      const [, lessThanTimestamp, equalTimestamp, lessThanId] = match;
      assert.equal(lessThanTimestamp, equalTimestamp, 'El límite temporal debe conservar toda su precisión.');
      rows = rows.filter(row =>
        row.created_at < lessThanTimestamp ||
        (row.created_at === equalTimestamp && row.id < lessThanId)
      );
    }
    rows.sort((a,b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
    );
    return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(resolve, reject);
  }
}

class FakeElement {
  constructor() {
    this.dataset = {};
    this.disabled = false;
    this.textContent = '';
    this._innerHTML = '';
    this.scrollHeight = 400;
    this.scrollTop = 0;
    this.lookup = {};
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.scrollHeight = this._innerHTML.length * 2;
  }
  get innerHTML() { return this._innerHTML; }
  querySelector(selector) { return this.lookup[selector] || null; }
}
const pane = new FakeElement();
const main = new FakeElement();
main.dataset.customer = 'customer-a';
main.querySelector = selector => selector === '.messages' ? pane : null;
const view = new FakeElement();
view.querySelector = selector => selector === '.chat-main' ? main : null;
const document = { getElementById: id => id === 'view-conversations' ? view : null };
const currentBusiness = { id: 'business-a' };
const toUuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
databaseRows = [
  ...Array.from({length:152}, (_,i) => ({
    id: toUuid(i+1),
    business_id: 'business-a',
    customer_id: 'customer-a',
    direction: i % 2 ? 'inbound' : 'outbound',
    body: 'Mensaje A ' + (i+1),
    created_at: '2026-11-23T12:00:00.123456+00:00',
  })),
  ...Array.from({length:75}, (_,i) => ({
    id: toUuid(i+201),
    business_id: 'business-a',
    customer_id: 'customer-b',
    direction: 'inbound',
    body: 'Mensaje B ' + (i+1),
    created_at: '2026-11-23T12:00:00.123456+00:00',
  })),
  ...Array.from({length:4}, (_,i) => ({
    id: toUuid(i+301),
    business_id: 'business-b',
    customer_id: 'customer-other',
    direction: 'inbound',
    body: 'Otro negocio ' + (i+1),
    created_at: '2026-11-23T12:00:00.123456+00:00',
  })),
];
const sb = { from: table => new FakeQuery(table) };
const toastMessages = [];
const window = {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, '');
const showToast = message => toastMessages.push(message);
const context = {
  document, currentBusiness, sb, window, esc, showToast, console,
  String, Map, Date, Number, Array, RegExp,
};
runInNewContext(
  source + '\nglobalThis.__api={cbMessageCursorFilter,cbLoadConversationHistory,state:conversationHistory};',
  context
);
const api = context.__api;

const exactCursor = {
  created_at: '2026-11-23T12:00:00.123456+00:00',
  id: toUuid(103),
};
assert.equal(
  api.cbMessageCursorFilter(exactCursor),
  'created_at.lt.2026-11-23T12:00:00.123456+00:00,and(created_at.eq.2026-11-23T12:00:00.123456+00:00,id.lt.' + toUuid(103) + ')',
  'El cursor debe conservar microsegundos y desempatar por UUID.'
);
assert.throws(() => api.cbMessageCursorFilter({ created_at: 'mañana', id: toUuid(1) }));
assert.throws(() => api.cbMessageCursorFilter({ created_at: exactCursor.created_at, id: 'invalido' }));

await api.cbLoadConversationHistory('customer-a', false);
assert.equal(api.state.rows.length, 50, 'La primera página debe mostrar 50 mensajes.');
assert.equal(api.state.hasMore, true);
assert.equal(api.state.rows[0].body, 'Mensaje A 103');
assert.equal(api.state.rows[49].body, 'Mensaje A 152');
assert.equal(calls[0].limit, 51, 'Debe leerse un registro adicional para detectar si existe otra página.');
assert.equal(calls[0].filters.business_id, 'business-a');
assert.equal(calls[0].filters.customer_id, 'customer-a');
assert.equal((pane.innerHTML.match(/class="bubble/g) || []).length, 50);

const oldHeight = pane.scrollHeight;
pane.scrollTop = 217;
await api.cbLoadConversationHistory('customer-a', true);
assert.equal(api.state.rows.length, 100);
assert.equal(api.state.rows[0].body, 'Mensaje A 53');
assert.equal(api.state.rows[99].body, 'Mensaje A 152');
assert.equal(pane.scrollTop, pane.scrollHeight - oldHeight + 217,
  'La posición visible debe conservarse al anteponer mensajes anteriores.');
assert.equal(calls[1].filters.business_id, 'business-a');
assert.equal(calls[1].filters.customer_id, 'customer-a');
assert.ok(calls[1].cursorFilter.includes('id.lt.' + toUuid(103)),
  'La segunda página debe continuar justo antes del último registro visible.');

await api.cbLoadConversationHistory('customer-a', true);
assert.equal(api.state.rows.length, 150);
assert.equal(api.state.hasMore, true);
await api.cbLoadConversationHistory('customer-a', true);
assert.equal(api.state.rows.length, 152);
assert.equal(api.state.hasMore, false);
assert.equal((pane.innerHTML.match(/class="bubble/g) || []).length, 152);
assert.equal(new Set(api.state.rows.map(row => row.id)).size, 152,
  'Las páginas no deben repetir ni perder mensajes con la misma fecha.');
assert.ok(api.state.rows.every(row => row.business_id === 'business-a' && row.customer_id === 'customer-a'));
assert.equal(calls.length, 4);
assert.ok(calls.every(call => call.filters.business_id === 'business-a' && call.filters.customer_id === 'customer-a'),
  'Cada página debe filtrar simultáneamente por negocio y cliente.');

main.dataset.customer = 'customer-b';
await api.cbLoadConversationHistory('customer-b', false);
assert.equal(api.state.customerId, 'customer-b');
assert.equal(api.state.rows.length, 50);
assert.ok(api.state.rows.every(row => row.customer_id === 'customer-b' && row.business_id === 'business-a'));
assert.equal(calls[4].filters.business_id, 'business-a');
assert.equal(calls[4].filters.customer_id, 'customer-b');

context.currentBusiness.id = 'business-b';
main.dataset.customer = 'customer-other';
await api.cbLoadConversationHistory('customer-other', false);
assert.equal(api.state.businessId, 'business-b');
assert.equal(api.state.rows.length, 4);
assert.ok(api.state.rows.every(row => row.business_id === 'business-b'));
assert.equal(calls[5].filters.business_id, 'business-b');
assert.equal(calls[5].filters.customer_id, 'customer-other');

console.log('CitaBot conversation keyset history pagination, timestamp ties, tenant isolation and scroll preservation: OK');
