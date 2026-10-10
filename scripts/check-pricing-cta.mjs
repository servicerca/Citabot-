import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const heading = html.indexOf("<h3>Premium</h3>");
assert.ok(heading >= 0, "public pricing must include the Premium plan");

const cardStart = html.lastIndexOf('<div class="plan-card">', heading);
const listEnd = html.indexOf("</ul>", heading);
const cardEnd = html.indexOf("</div>", listEnd);
assert.ok(cardStart >= 0 && listEnd > heading && cardEnd > listEnd,
  "could not isolate the public Premium pricing card");

const card = html.slice(cardStart, cardEnd + "</div>".length);
assert.match(card, /<button\\b[^>]*onclick="showOnboarding\\(\\)"/,
  "Premium card must have a working signup action");
assert.match(card, /Crear cuenta gratis/,
  "CTA must explain that account creation is the next step");

console.log("CitaBot public Premium pricing CTA: OK");
