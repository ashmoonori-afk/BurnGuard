import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const entries = await readdir(root);
const expectedFiles = entries.filter((name) => /^expected-.*\.json$/.test(name)).sort();
assert.equal(expectedFiles.length, 5);
const documents = await Promise.all(expectedFiles.map(async (name) =>
  JSON.parse(await readFile(new URL(name, root), "utf8"))));
const tokens = await readFile(new URL("tokens.css", root), "utf8");
const tokenNames = new Set([...tokens.matchAll(/^\s+(--[\w-]+):/gm)].map((match) => match[1]));
const ids = new Set();
const categories = new Set();
const sources = new Map();
const totals = { positive: 0, negative: 0, unresolved: 0 };
let ambiguous = 0;
let eligible = 0;
let spans = 0;

for (const document of documents) {
  assert.ok(["colour", "radius", "spacing", "font_size", "shadow"].includes(document.category));
  assert.ok(!categories.has(document.category), "Duplicate category");
  categories.add(document.category);
  assert.equal(typeof document.distance_metric, "string");
  assert.ok(Array.isArray(document.cases));
  const counts = { positive: 0, negative: 0, unresolved: 0 };
  for (const row of document.cases) {
    assert.ok(Array.isArray(row));
    assert.equal(row.length, 12);
    const [id, file, line, selector, property, value, literal, mode, label, candidates, fix, reason] = row;
    assert.match(id, /^[crsfh]-(?:p|n|u)\d\d$/);
    assert.ok(!ids.has(id), `Duplicate ID ${id}`);
    ids.add(id);
    assert.match(file, /^[a-z][a-z-]*\.(?:css|html|tsx\.txt)$/);
    assert.ok(Number.isInteger(line) && line > 0);
    for (const text of [selector, property, value, literal, reason]) {
      assert.equal(typeof text, "string", id);
      assert.ok(text.length > 0, id);
    }
    assert.ok(["light", "dark", "both"].includes(mode), id);
    assert.ok(Object.hasOwn(totals, label), id);
    counts[label] += 1;
    totals[label] += 1;
    if (!sources.has(file)) {
      sources.set(file, (await readFile(new URL(file, root), "utf8")).split("\n"));
    }
    const sourceLine = sources.get(file)?.[line - 1];
    assert.equal(typeof sourceLine, "string", `${id}: missing source line`);
    assert.equal(sourceLine.split(id).length - 1, 1, `${id}: missing or duplicated line marker`);
    assert.equal(sourceLine.split(literal).length - 1, 1, `${id}: ambiguous or missing literal span`);
    spans += 1;
    if (file.endsWith(".css")) {
      assert.ok(sourceLine.includes(`${property}: ${value}`), `${id}: declaration anchor`);
      if (file === "tokens.css") {
        const precedingLines = sources.get(file).slice(0, line - 1);
        const opening = precedingLines.findLastIndex((text) => text.includes("{"));
        assert.equal(precedingLines[opening], `${selector} {`, `${id}: token block selector`);
        assert.ok(!precedingLines.slice(opening + 1).some((text) => text.includes("}")), id);
      } else {
        const selectorParts = selector.split(" .child");
        assert.ok(sourceLine.startsWith(`${selectorParts[0]} {`), `${id}: selector anchor`);
        if (selectorParts.length > 1) assert.ok(sourceLine.includes("& .child {"), id);
      }
    }
    if (file.endsWith(".html")) {
      assert.ok(sourceLine.includes(`id="${id}"`), id);
      assert.equal(selector, `#${id}`);
      assert.ok(sourceLine.includes(`${property}: ${value}`), `${id}: inline declaration anchor`);
    }
    if (file.endsWith(".tsx.txt")) {
      assert.ok(sourceLine.includes(`data-case="${id}"`), id);
      assert.equal(selector, `[data-case="${id}"]`);
      assert.ok(sourceLine.includes("className=") || sourceLine.includes("style={{"), id);
    }
    assert.ok(Array.isArray(candidates), id);
    const candidateNames = new Set();
    for (const candidate of candidates) {
      assert.ok(Array.isArray(candidate) && candidate.length === 2, id);
      const [name, distance] = candidate;
      assert.ok(tokenNames.has(name), `${id}: unknown token candidate`);
      assert.ok(!candidateNames.has(name), `${id}: duplicate candidate`);
      candidateNames.add(name);
      assert.ok(Number.isFinite(distance) && distance >= 0, id);
    }
    assert.ok(Array.isArray(fix) && fix.length === 2, id);
    assert.equal(typeof fix[0], "boolean", id);
    if (candidates.length > 1) ambiguous += 1;
    if (fix[0]) {
      eligible += 1;
      assert.equal(label, "positive", id);
      assert.equal(candidates.length, 1, `${id}: unsafe candidate tie`);
      assert.equal(candidates[0][1], 0, `${id}: approximate automatic fix`);
      assert.equal(typeof fix[1], "string", id);
      assert.ok(fix[1].includes(`var(${candidates[0][0]})`), id);
    } else {
      assert.equal(fix[1], null, id);
    }
    if (label !== "positive") assert.equal(candidates.length, 0, id);
  }
  assert.deepEqual(counts, { positive: 14, negative: 14, unresolved: 2 });
  console.log(`${document.category}: ${counts.positive} positive, ${counts.negative} negative, ${counts.unresolved} unresolved`);
}

assert.equal(categories.size, 5);
assert.deepEqual(totals, { positive: 70, negative: 70, unresolved: 10 });
assert.equal(ids.size, 150);
for (const [file, lines] of sources) {
  const markers = [...lines.join("\n").matchAll(/\b[crsfh]-(?:p|n|u)\d\d\b/g)].map((match) => match[0]);
  for (const marker of new Set(markers)) {
    assert.ok(ids.has(marker), `${file}: unlabelled marker ${marker}`);
  }
}
console.log(`PASS: ${ids.size} unique IDs, ${spans} exact source spans, ${ambiguous} tied-candidate assertions, ${eligible} eligible fixes; no detector invoked.`);
