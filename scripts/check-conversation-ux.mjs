import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function cbRenderConversations()');
const end = html.indexOf('window.deleteBusinessProfile=', start);
assert.ok(start >= 0 && end > start, 'El renderizador de Mensajes debe poder delimitarse.');
const renderer = html.slice(start, end);

assert.match(renderer, /id="conversationPicker"/);
assert.match(renderer, /id="conversationSearch"/);
assert.match(renderer, /button type="button" class="chat-item/);
assert.match(renderer, /aria-pressed=/);
assert.match(renderer, /aria-label="Abrir conversación con/);
assert.match(renderer, /button\.addEventListener\('click'/);
assert.match(renderer, /select\?\.addEventListener\('change'/);
assert.match(renderer, /search\?\.addEventListener\('input'/);
assert.match(renderer, /if\(composer\)composer\.disabled=true/);
assert.match(html, /\.chat-item\[hidden\]\{display:none\}/);
assert.match(html, /#view-conversations \.chat-picker-mobile\{display:grid/);
assert.match(html, /#view-conversations \.chat-list\{display:none\}/);
assert.match(html, /label for="conversationSearch"/);
assert.match(html, /label for="conversationPicker"/);

class FakeClassList {
  constructor(initial = []) { this.values = new Set(initial); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value); else this.values.delete(value);
    return enabled;
  }
}
class FakeElement {
  constructor() {
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.classList = new FakeClassList();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.children = [];
  }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelectorAll(selector) {
    return selector === '.chat-item' ? this.children : [];
  }
  querySelector(selector) {
    return this.lookup?.[selector] || null;
  }
  set innerHTML(value) {
    this._innerHTML = value;
    if (this.isList) {
      this.children = [];
      const regex = /<button type="button" class="chat-item ([^"]*)" data-customer="([^"]+)"([^>]*)>/g;
      let match;
      while ((match = regex.exec(value))) {
        const button = new FakeElement();
        button.dataset.customer = match[2];
        if (match[1].includes('selected')) button.classList.add('selected');
        const pressed = match[3].match(/aria-pressed="(true|false)"/);
        button.attributes['aria-pressed'] = pressed?.[1] || 'false';
        this.children.push(button);
      }
    }
  }
  get innerHTML() { return this._innerHTML || ''; }
}
const makeHarness = (customers, messages) => {
  const view = new FakeElement();
  const list = new FakeElement(); list.isList = true;
  const picker = new FakeElement();
  const main = new FakeElement();
  const head = new FakeElement();
  const messagesPane = new FakeElement();
  const composer = new FakeElement();
  const send = new FakeElement();
  const search = new FakeElement();
  const select = new FakeElement();
  list.lookup = { '#conversationSearch': search };
  list.querySelector = selector => list.lookup[selector] || null;
  picker.querySelector = selector => selector === '#conversationPicker' ? select : null;
  main.querySelector = selector => selector.includes('border-bottom') ? head : selector === '.messages' ? messagesPane : null;
  view.querySelector = selector => ({
    '.chat-list': list,
    '#conversationPickerMobile': picker,
    '.chat-main': main,
    '#msgInput': composer,
    '#sendMsgBtn': send,
  })[selector] || null;
  const document = { getElementById: id => id === 'view-conversations' ? view : null };
  const currentData = { customers, messages };
  const esc = value => String(value ?? '').replace(/[&<>"]/g, '');
  runInNewContext(renderer + '\ncbRenderConversations();', {
    document, window: {}, currentData, esc, String, Map, Intl,
  });
  return { list, picker, main, head, messagesPane, composer, send, search, select };
};

const customers = [
  { id: 'customer-b', name: 'Brenda', phone: '+57 300 222 2222' },
  { id: 'customer-a', name: 'Ana', phone: '+57 300 111 1111' },
];
const messages = [
  { customer_id: 'customer-a', direction: 'inbound', body: 'Necesito una cita' },
  { customer_id: 'customer-b', direction: 'inbound', body: 'Quiero conocer los horarios' },
];
const harness = makeHarness(customers, messages);
assert.equal(harness.main.dataset.customer, 'customer-a',
  'La primera conversación debe elegirse de forma predecible.');
assert.match(harness.head.innerHTML, /Ana/);
assert.match(harness.messagesPane.innerHTML, /Necesito una cita/);
assert.equal(harness.send.disabled, false);

const brendaButton = harness.list.children.find(button => button.dataset.customer === 'customer-b');
assert.ok(brendaButton, 'La otra conversación debe permanecer seleccionable.');
brendaButton.events.click();
assert.equal(harness.main.dataset.customer, 'customer-b');
assert.match(harness.head.innerHTML, /Brenda/);
assert.match(harness.messagesPane.innerHTML, /Quiero conocer los horarios/);
assert.equal(harness.select.value, 'customer-b');

harness.search.value = 'brenda';
harness.search.events.input();
const anaButton = harness.list.children.find(button => button.dataset.customer === 'customer-a');
assert.equal(anaButton.hidden, true, 'La búsqueda debe ocultar conversaciones no coincidentes.');
assert.equal(brendaButton.hidden, false, 'La búsqueda debe conservar la conversación coincidente.');

harness.select.value = 'customer-a';
harness.select.events.change();
assert.equal(harness.main.dataset.customer, 'customer-a',
  'El selector móvil debe poder cambiar de conversación.');
assert.equal(harness.messagesPane.innerHTML.includes('Necesito una cita'), true);

const empty = makeHarness([{id:'customer-a',name:'Ana'}], []);
assert.equal(empty.main.dataset.customer, undefined);
assert.equal(empty.send.disabled, true, 'No se debe poder enviar desde una pantalla sin conversaciones.');
assert.equal(empty.composer.disabled, true);
assert.match(empty.messagesPane.innerHTML, /Aún no hay mensajes reales/);

console.log('CitaBot mobile conversation picker and accessible search: OK');
