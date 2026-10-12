import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

console.log('CitaBot password exposure checks: static guard + runtime edge cases OK');
