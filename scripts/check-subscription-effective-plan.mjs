import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("function cbTrialActive()");
const end = html.indexOf("function cbPlanLabel()", start);
assert.notEqual(start, -1, "Debe existir cbTrialActive.");
assert.notEqual(end, -1, "No se pudo delimitar cbEffectivePlan.");
const functions = html.slice(start, end);

function effectivePlan(subscription) {
  const source = `
    let currentData = { subscription: ${JSON.stringify(subscription)} };
    ${functions}
    cbEffectivePlan();
  `;
  return vm.runInNewContext(source);
}

