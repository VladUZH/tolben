import test from "node:test";
import assert from "node:assert/strict";
import { repairMechanics } from "../src/mechanics.mjs";

test("repairs spacing and capitalisation faults", () => {
  assert.equal(repairMechanics("The package includes paper,ink, and labels.").replacement,
    "The package includes paper, ink, and labels.");
  assert.equal(repairMechanics("The review was brief , but it was thorough.").replacement,
    "The review was brief, but it was thorough.");
  assert.equal(repairMechanics("we stored the original receipt in the safe.").replacement,
    "We stored the original receipt in the safe.");
  assert.equal(repairMechanics("The workshop begins on wednesday morning.").replacement,
    "The workshop begins on Wednesday morning.");
});

test("leaves correct sentences untouched", () => {
  for (const text of [
    "The launch begins tomorrow.",
    "The sensor records temperature every minute.",
    "Read https://example.test/a, then stop.",
    "Open /srv/reports/q4.csv now.",
  ]) assert.equal(repairMechanics(text), null, text);
});

test("does not capitalise ordinary words that share a month name", () => {
  assert.equal(repairMechanics("The valve may fail under load."), null);
  assert.equal(repairMechanics("They march toward the gate."), null);
  assert.equal(repairMechanics("The valve may need a new seal."), null);
});

test("capitalises a month only beside a date signal", () => {
  assert.equal(repairMechanics("The contract renews in march.")?.replacement, "The contract renews in March.");
  assert.equal(repairMechanics("The audit begins in may.")?.replacement, "The audit begins in May.");
});

test("collapses every repeated space, not every other one", () => {
  assert.equal(repairMechanics("Section  A  is  ready.").replacement, "Section A is ready.");
  assert.equal(repairMechanics("One  two  three  four  five.").replacement, "One two three four five.");
});

test("never inserts a space inside a URL, a path, or a file name", () => {
  for (const text of [
    "https://ex.com/a,b",
    "Read https://ex.com/a,b now.",
    "/srv/data,backup",
    "Open /srv/data,backup today.",
    "The archive is at C:\\logs,old.",
    "Mail ops@example.test,now.",
  ]) assert.equal(repairMechanics(text), null, text);
});

test("never capitalises a leading file name, path, or identifier", () => {
  for (const text of [
    "config.json holds the settings.",
    "src/app.js is the entry point.",
    "v2 of the schema is live.",
    "npm_config_cache is unset.",
  ]) assert.equal(repairMechanics(text), null, text);
});

test("a day name inside a path is a directory, not a missing capital", () => {
  assert.equal(repairMechanics("Open /srv/monday/report.csv now."), null);
});

test("a repair that would rename a protected token is withheld", () => {
  // Belt and braces: whatever the fixes do, the URLs, paths, and file names of the
  // original have to survive the repair unchanged, or nothing is offered at all.
  const cases = [
    "https://ex.com/a,b",
    "config.json holds the settings.",
    "/srv/data,backup",
  ];
  for (const text of cases) {
    const repaired = repairMechanics(text);
    if (repaired === null) continue;
    for (const token of text.match(/https?:\/\/\S+|\/\S+|\b[\w-]+\.\w+\b/gu) ?? []) {
      assert.ok(repaired.replacement.includes(token),
        `repair lost ${token}: ${repaired.replacement}`);
    }
  }
});

test("ordinary spacing and capitalisation repairs still happen", () => {
  assert.equal(repairMechanics("we met on friday,and signed it.").replacement,
    "We met on Friday, and signed it.");
  assert.equal(repairMechanics("The result was clear , and final.").replacement,
    "The result was clear, and final.");
});
