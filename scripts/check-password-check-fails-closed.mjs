import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
console.log('CitaBot leaked-password check fail-closed guard: OK');
