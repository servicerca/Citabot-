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


assert.equal(
  effectivePlan({ plan: "professional", status: "active" }),
  "professional",
  "Professional remains available only while active.",
);
assert.equal(
  effectivePlan({ plan: "premium", status: "active" }),
  "premium",
  "Premium remains available only while active.",
);
assert.equal(
  effectivePlan({ plan: "professional", status: "past_due" }),
  "free",
  "Past-due Professional must not unlock paid features.",
);
assert.equal(
  effectivePlan({ plan: "premium", status: "paused" }),
  "free",
  "Paused Premium must not unlock paid features.",
);
assert.equal(
  effectivePlan({ plan: "professional", status: "pending" }),
  "free",
  "Pending checkout must not unlock paid features.",
);
assert.equal(
  effectivePlan({ plan: "trial", status: "trialing", trial_ends_at: "2999-01-01T00:00:00.000Z" }),
  "trial",
  "A valid unexpired trial remains available.",
);
assert.equal(
  effectivePlan({ plan: "trial", status: "trialing", trial_ends_at: "2020-01-01T00:00:00.000Z" }),
  "free",
  "An expired trial must return to free.",
);
assert.equal(effectivePlan(null), "free", "Missing subscription must use free.");
console.log("CitaBot effective plan status gate: all scenarios passed.");
