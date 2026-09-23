/**
 * Fails when a document uses an abbreviation the glossary doesn't explain.
 *
 * Readers hover an abbreviation to see it spelled out, which only works if
 * `lib/glossary.ts` knows it. This finds every abbreviation-shaped word in the
 * prose of `content/` — code blocks and inline code excluded, since they are
 * rendered literally — and reports any that is in neither `GLOSSARY` nor
 * `NOT_ABBREVIATIONS`.
 *
 * "Abbreviation-shaped" means at least two capitals, and capitals for at least
 * half the letters once a plural "s" is dropped: APNs, DDoS and PoPs are,
 * DynamoDB and WebSocket aren't.
 *
 * Run with `npm run check:abbr`. Like `check-viz.mjs`, it bundles the
 * TypeScript with esbuild instead of needing a build step of its own.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

async function loadGlossary() {
  const dir = await mkdtemp(join(tmpdir(), "abbr-check-"));
  const outfile = join(dir, "bundle.mjs");
  await build({ entryPoints: ["lib/glossary.ts"], bundle: true, format: "esm", outfile, logLevel: "error" });
  const glossary = await import(`file://${outfile}`);
  await rm(dir, { recursive: true, force: true });
  return glossary;
}

const { GLOSSARY, NOT_ABBREVIATIONS } = await loadGlossary();
const known = new Set([...Object.keys(GLOSSARY), ...NOT_ABBREVIATIONS]);

function looksLikeAbbreviation(word) {
  const stem = word.replace(/s$/, "");
  const letters = stem.replace(/[^A-Za-z]/g, "");
  const capitals = stem.replace(/[^A-Z]/g, "").length;
  return capitals >= 2 && capitals * 2 >= letters.length;
}

// Keys like "TF-IDF" and "LL-HLS" are taken out whole first, so their parts
// ("IDF", "LL") aren't reported on their own.
const escape = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compounds = new RegExp(
  `\\b(?:${Object.keys(GLOSSARY)
    .filter((key) => /[-.]/.test(key))
    .map(escape)
    .join("|")})s?\\b`,
  "g",
);

const problems = new Map();
const files = (await readdir("content", { recursive: true })).filter((file) => file.endsWith(".md"));

for (const file of files) {
  const prose = (await readFile(join("content", file), "utf8"))
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(compounds, "");

  for (const [word] of prose.matchAll(/\b[A-Za-z][A-Za-z0-9]*\b/g)) {
    if (!looksLikeAbbreviation(word)) continue;
    if (known.has(word) || known.has(word.replace(/s$/, ""))) continue;
    if (!problems.has(word)) problems.set(word, new Set());
    problems.get(word).add(file);
  }
}

if (problems.size > 0) {
  console.error(`${problems.size} abbreviation(s) without a glossary entry:\n`);
  for (const [word, where] of [...problems].sort()) console.error(`  ${word}  (${[...where].join(", ")})`);
  console.error(
    "\nAdd each to GLOSSARY in lib/glossary.ts so readers can hover it, or to NOT_ABBREVIATIONS if it needs no explanation.",
  );
  process.exit(1);
}

console.log(`Every abbreviation in ${files.length} documents is in the glossary.`);
