/**
 * Validates every visualisation before it can ship.
 *
 * A visualisation is data, so most of what can go wrong with one is checkable:
 * a node id used twice in a frame, an edge pointing at a node that frame does
 * not contain, a `codeLines` entry past the end of the listing, a drawing wider
 * than the canvas it declares, or two solid boxes sitting on top of each other.
 * Every one of those has shipped at least once, which is why this exists.
 *
 * Run with `npm run check:viz`. It bundles the registry with esbuild rather
 * than importing the TypeScript directly, so it needs no build step of its own.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

/** Notes and markers are annotations and may sit over other things; solid boxes may not. */
const ANNOTATIONS = new Set(["note", "marker"]);

const rect = (node) => ({
  x: node.x,
  y: node.y,
  w: node.width ?? 140,
  h: node.height ?? 34,
});

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function loadVizzes() {
  const dir = await mkdtemp(join(tmpdir(), "viz-check-"));
  const outfile = join(dir, "bundle.mjs");
  await build({
    entryPoints: ["lib/viz/registry.ts"],
    bundle: true,
    format: "esm",
    outfile,
    logLevel: "error",
  });
  const { vizzes } = await import(`file://${outfile}`);
  await rm(dir, { recursive: true, force: true });
  return vizzes;
}

const vizzes = await loadVizzes();
const problems = [];

for (const [id, viz] of Object.entries(vizzes)) {
  const report = (message) => problems.push(`${id}: ${message}`);
  const codeLength = viz.code ? viz.code.source.split("\n").length : 0;
  let usedWidth = 0;
  let usedHeight = 0;
  const reportedPairs = new Set();

  viz.frames.forEach((frame, index) => {
    const position = `frame ${index + 1} (${frame.label ?? "unlabelled"})`;
    if (!frame.label || !frame.caption) report(`${position} is missing a label or a caption`);

    const ids = new Set();
    for (const node of frame.nodes) {
      if (ids.has(node.id)) report(`${position} uses the node id "${node.id}" twice`);
      ids.add(node.id);
      if (node.x < 0 || node.y < 0) report(`${position} places "${node.id}" at (${node.x}, ${node.y})`);
      const box = rect(node);
      usedWidth = Math.max(usedWidth, box.x + box.w);
      usedHeight = Math.max(usedHeight, box.y + box.h);
    }

    for (const edge of frame.edges ?? []) {
      if (!ids.has(edge.source)) report(`${position}: edge "${edge.id}" starts at missing node "${edge.source}"`);
      if (!ids.has(edge.target)) report(`${position}: edge "${edge.id}" ends at missing node "${edge.target}"`);
    }

    for (const line of frame.codeLines ?? []) {
      if (line < 1 || line > codeLength) {
        report(`${position} highlights line ${line}, outside the listing's 1..${codeLength}`);
      }
    }

    const solid = frame.nodes.filter((node) => !ANNOTATIONS.has(node.shape));
    for (let i = 0; i < solid.length; i += 1) {
      for (let j = i + 1; j < solid.length; j += 1) {
        if (!overlaps(rect(solid[i]), rect(solid[j]))) continue;
        const pair = `${solid[i].id} over ${solid[j].id}`;
        if (reportedPairs.has(pair)) continue;
        reportedPairs.add(pair);
        report(`${position} draws ${pair}`);
      }
    }
  });

  if (usedWidth > viz.width) report(`content is ${usedWidth}px wide but the canvas declares ${viz.width}`);
  if (usedHeight > viz.height) report(`content is ${usedHeight}px tall but the canvas declares ${viz.height}`);

  const frames = String(viz.frames.length).padStart(2);
  console.log(`${id.padEnd(22)} ${frames} frames · ${String(codeLength).padStart(2)} code lines`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(`\n${Object.keys(vizzes).length} visualisations checked, no problems.`);
