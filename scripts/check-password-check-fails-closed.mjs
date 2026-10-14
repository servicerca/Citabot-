import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const privacyPolicy = readFileSync(new URL('../politica-privacidad.html', import.meta.url), 'utf8');
const terms = readFileSync(new URL('../terminos-servicio.html', import.meta.url), 'utf8');

assert.ok(html.includes("citabot_legal_version:'2026-10-14-v2'"), 'new signup consent must record the updated legal bundle version');
assert.ok(html.includes('Pwned Passwords') && html.includes('no se envía la contraseña completa ni el hash completo'), 'the in-app privacy notice must explain the external password exposure check and the data minimization behavior');
assert.ok(privacyPolicy.includes('Pwned Passwords') && privacyPolicy.includes('cinco primeros caracteres hexadecimales') && privacyPolicy.includes('no se envía la contraseña completa ni el hash completo'), 'the standalone privacy policy must disclose Pwned Passwords and explain the truncated hash prefix');
assert.ok(privacyPolicy.includes('Última actualización: 14 de octubre de 2026'), 'the standalone privacy policy date must match the updated disclosure');
assert.ok(terms.includes('Última actualización:</strong> 14 de octubre de 2026'), 'the terms date must match the updated legal bundle');
const submitAt = html.indexOf('window.cbSubmitAuth=async()=>');
const checkerAt = html.indexOf('async function cbCheckPasswordExposure');
const guard = "if(!exposure.checked){msg('No se pudo comprobar la seguridad de la contraseña. Reinténtalo cuando tengas conexión.');return;}";
const guardAt = html.indexOf(guard, submitAt);
const leakedPasswordDecisionAt = html.indexOf('if(exposure.compromised)', submitAt);
const signupAt = html.indexOf("if(authMode==='signup'){r=await sb.auth.signUp", submitAt);

assert.ok(submitAt >= 0, 'signup handler must exist');
assert.ok(checkerAt >= 0 && checkerAt < submitAt, 'password exposure checker must be defined before the signup handler');
assert.ok(guardAt > submitAt, 'signup handler must reject an unavailable exposure check');
assert.ok(leakedPasswordDecisionAt > guardAt, 'availability must be checked before the leaked-password decision');
assert.ok(signupAt > leakedPasswordDecisionAt, 'password check must run before Supabase signup');
assert.ok(html.includes("fetch('https://api.pwnedpasswords.com/range/'+prefix"), 'use the Pwned Passwords range endpoint');

const checkerEnd = html.indexOf('function cbPasswordMessage()', checkerAt);
assert.ok(checkerAt >= 0 && checkerEnd > checkerAt, 'password exposure checker source must be extractable');
const checkerSource = html.slice(checkerAt, checkerEnd);
const suffix = '0'.repeat(35);
function makeChecker(fetchImpl, cryptoAvailable = true) {
  const sandbox = {
    window: { crypto: cryptoAvailable ? { subtle: { digest: async () => new Uint8Array(20).buffer } } : null },
    TextEncoder,
    Uint8Array,
    fetch: fetchImpl,
    console: { warn() {} }
  };
  vm.runInNewContext(checkerSource + '\nglobalThis.__checkPassword = cbCheckPasswordExposure;', sandbox, { timeout: 1000 });
  return sandbox.__checkPassword;
}
function response(body, ok = true) {
  return { ok, text: async () => body };
}

let requestedUrl = '';
const validUncompromised = makeChecker(async url => {
  requestedUrl = url;
  return response(suffix + ':0\n' + 'A'.repeat(35) + ':0');
});
const clean = await validUncompromised('sample-password');
assert.equal(clean.checked, true, 'a valid range response must complete the check');
assert.equal(clean.compromised, false, 'zero count must be treated as not found');
assert.equal(clean.count, 0);
assert.equal(requestedUrl, 'https://api.pwnedpasswords.com/range/00000', 'only the five-character hash prefix should be sent');

const validCompromised = makeChecker(async () => response(suffix + ':17'));
const leaked = await validCompromised('sample-password');
assert.equal(leaked.checked, true);
assert.equal(leaked.compromised, true, 'positive count must identify an exposed password');
assert.equal(leaked.count, 17);

for (const malformedBody of ['', 'upstream unavailable', suffix + ':not-a-count', 'short:1']) {
  const checker = makeChecker(async () => response(malformedBody));
  const result = await checker('sample-password');
  assert.equal(result.checked, false, 'malformed response must fail closed: ' + JSON.stringify(malformedBody));
  assert.equal(result.compromised, false);
}

const unavailable = makeChecker(async () => response('', false));
assert.equal((await unavailable('sample-password')).checked, false, 'non-2xx response must fail closed');

const networkFailure = makeChecker(async () => { throw new Error('network down'); });
assert.equal((await networkFailure('sample-password')).checked, false, 'network errors must fail closed');

const noCrypto = makeChecker(async () => { throw new Error('must not be called'); }, false);
assert.equal((await noCrypto('sample-password')).checked, false, 'missing Web Crypto must fail closed');


const submitEnd = html.indexOf('window.cbResetPassword=async()=>', submitAt);
assert.ok(submitEnd > submitAt, 'signup handler source must be extractable for a behavior test');
const submitSource = html.slice(submitAt, submitEnd);
async function exerciseSignup(exposureResult) {
  const messages = [];
  let signupCalls = 0;
  const elements = {
    cbAuthEmail: { value: 'shop@example.invalid' },
    cbAuthPassword: { value: 'Valid!Password123' },
    cbAuthName: { value: 'Test shop' },
    cbAuthPasswordConfirm: { value: 'Valid!Password123' },
    cbAuthConsent: { checked: true },
    cbAuthSubmit: { disabled: false }
  };
  const sandbox = {
    window: {},
    authMode: 'signup',
    $: id => elements[id] || null,
    cbPasswordPolicy: () => true,
    cbPasswordMessage: () => 'invalid password',
    cbCheckPasswordExposure: async () => exposureResult,
    msg: message => messages.push(message),
    sb: { auth: { signUp: async () => {
      signupCalls += 1;
      return { data: { session: null }, error: null };
    } } },
    cbBoot() {},
    cbBootHide() {},
    location: { href: 'https://example.invalid/' },
    cbLoadOrOnboard: async () => {}
  };
  vm.runInNewContext(submitSource, sandbox, { timeout: 1000 });
  await sandbox.window.cbSubmitAuth();
  return { signupCalls, messages, buttonEnabledAgain: elements.cbAuthSubmit.disabled === false };
}
const failedCheckSubmit = await exerciseSignup({ checked: false, compromised: false });
assert.equal(failedCheckSubmit.signupCalls, 0, 'signup must never call Supabase when the exposure check is unavailable');
assert.ok(failedCheckSubmit.messages.some(m => String(m).includes('No se pudo comprobar')), 'user must receive a clear retry message');
assert.equal(failedCheckSubmit.buttonEnabledAgain, true, 'submit button must be re-enabled after fail-closed rejection');

const leakedPasswordSubmit = await exerciseSignup({ checked: true, compromised: true, count: 5 });
assert.equal(leakedPasswordSubmit.signupCalls, 0, 'signup must never call Supabase for an exposed password');
assert.ok(leakedPasswordSubmit.messages.some(m => String(m).includes('filtraciones')), 'user must be told to choose another password');

const safePasswordSubmit = await exerciseSignup({ checked: true, compromised: false, count: 0 });
assert.equal(safePasswordSubmit.signupCalls, 1, 'valid clean password should be allowed to proceed to Supabase signup');
assert.ok(safePasswordSubmit.messages.some(m => String(m).includes('Cuenta creada')), 'successful auth response must be handled');
assert.equal(safePasswordSubmit.buttonEnabledAgain, true, 'submit button should be re-enabled after the auth request');

console.log('CitaBot password exposure checks: static guard + runtime edge cases OK');
