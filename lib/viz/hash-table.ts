import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * Hash map: hash → index → bucket, and what a collision costs.
 *
 * Every frame is built from the same `scene()` call, so the drawing is a pure
 * function of "which pairs are stored and what is being done to them". Ids are
 * stable across frames — `slot:3` is bucket three whether it is empty or full —
 * which is what lets the player animate between them.
 */

const BUCKETS = 8;
const ROW_X = 24;
const ROW_Y = 152;
const CELL_W = 96;
const CELL_H = 36;
const CELL_PITCH = CELL_W + 8;
/** Chains hang below their bucket, so a long chain grows down, not sideways. */
const CHAIN_TOP = 214;
const CHAIN_PITCH = 62;
const LANE_Y = 40;

const cellX = (bucket: number) => ROW_X + bucket * CELL_PITCH;
const laneY = (lane: number) => (lane === 0 ? ROW_Y : CHAIN_TOP + (lane - 1) * CHAIN_PITCH);

interface Entry {
  key: string;
  value: string;
  bucket: number;
}

interface Chip {
  key: string;
  value: string;
  /** Where the key is right now: waiting, at the hash, or over a bucket lane. */
  at: "in" | "hash" | { bucket: number; lane: number };
  detail?: string;
  tone?: VizTone;
  state?: "active" | "pulsing";
}

interface SceneOpts {
  entries: Entry[];
  chip?: Chip;
  /** Result line inside the hash box, e.g. `hash("cat") % 8 → 3`. */
  hashText?: string;
  /** Draws the hash box's arrow into this bucket. */
  hashTo?: number;
  focus?: string[];
  dim?: string[];
  pulse?: string[];
  tones?: Record<string, VizTone>;
  /** A "compare" cursor under the entry currently being checked. */
  probe?: { key: string; label: string; tone: VizTone };
}

const slotId = (bucket: number) => `slot:${bucket}`;
const entryId = (key: string) => `entry:${key}`;

/** Chain position of an entry within its bucket: 0 is the bucket cell itself. */
function lanes(entries: Entry[]): Map<string, { bucket: number; lane: number }> {
  const counts = new Array<number>(BUCKETS).fill(0);
  const placed = new Map<string, { bucket: number; lane: number }>();
  for (const entry of entries) {
    placed.set(entry.key, { bucket: entry.bucket, lane: counts[entry.bucket] });
    counts[entry.bucket] += 1;
  }
  return placed;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { entries, chip, focus = [], dim = [], pulse = [], tones = {} } = opts;
  const placed = lanes(entries);
  const nodes: VizNode[] = [];
  const edges: VizEdge[] = [];

  const decorate = (node: VizNode): VizNode => ({
    ...node,
    tone: tones[node.id] ?? node.tone,
    state: pulse.includes(node.id)
      ? "pulsing"
      : focus.includes(node.id)
        ? "active"
        : dim.includes(node.id)
          ? "dimmed"
          : node.state,
  });

  nodes.push(
    { id: "note:keys", shape: "note", x: 36, y: 16, width: 160, height: 16, title: "put / get" },
    { id: "note:buckets", shape: "note", x: ROW_X, y: 124, width: 200, height: 16, title: "buckets[8]" },
    { id: "note:chain", shape: "note", x: ROW_X, y: CHAIN_TOP + 8, width: 100, height: 16, title: "chain" },
  );

  nodes.push(
    decorate({
      id: "hash",
      shape: "op",
      x: 320,
      y: 34,
      width: 220,
      height: 52,
      title: "hash(key) % 8",
      detail: opts.hashText ?? "any key → one index",
      tone: "violet",
    }),
  );

  for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
    const head = entries.find((entry) => placed.get(entry.key)?.bucket === bucket && placed.get(entry.key)?.lane === 0);
    nodes.push(
      decorate({
        id: slotId(bucket),
        shape: head ? "box" : "slot",
        x: cellX(bucket),
        y: ROW_Y,
        width: CELL_W,
        height: CELL_H,
        index: String(bucket),
        title: head ? head.key : "empty",
        detail: head?.value,
        tone: head ? "green" : "neutral",
      }),
    );
  }

  for (const entry of entries) {
    const spot = placed.get(entry.key);
    if (!spot || spot.lane === 0) continue;
    const previous = entries.find((other) => {
      const at = placed.get(other.key);
      return at?.bucket === spot.bucket && at.lane === spot.lane - 1;
    });
    nodes.push(
      decorate({
        id: entryId(entry.key),
        shape: "box",
        x: cellX(spot.bucket),
        y: laneY(spot.lane),
        width: CELL_W,
        height: CELL_H,
        title: entry.key,
        detail: entry.value,
        tone: "green",
      }),
    );
    const source = previous && placed.get(previous.key)?.lane === 0 ? slotId(spot.bucket) : entryId(previous?.key ?? "");
    edges.push({
      id: `link:${entry.key}`,
      source,
      target: entryId(entry.key),
      sourceSide: "b",
      targetSide: "t",
      label: "next",
    });
  }

  if (opts.hashTo !== undefined) {
    edges.push({
      id: "link:hash",
      source: "hash",
      target: slotId(opts.hashTo),
      sourceSide: "b",
      targetSide: "t",
      label: `index ${opts.hashTo}`,
      state: "active",
    });
  }

  if (chip) {
    const position =
      chip.at === "in"
        ? { x: 36, y: LANE_Y }
        : chip.at === "hash"
          ? { x: 580, y: LANE_Y }
          : { x: cellX(chip.at.bucket), y: laneY(chip.at.lane) };
    nodes.push({
      id: "chip",
      shape: "chip",
      ...position,
      width: CELL_W,
      height: CELL_H,
      title: chip.key,
      detail: chip.detail ?? chip.value,
      tone: chip.tone ?? "amber",
      state: chip.state ?? "active",
    });
  }

  if (opts.probe) {
    const spot = placed.get(opts.probe.key);
    if (spot) {
      // The bucket row is packed, so a cursor on it goes above; a chain row has
      // its whole left side free.
      const onRow = spot.lane === 0;
      nodes.push({
        id: "probe",
        shape: "marker",
        x: onRow ? cellX(spot.bucket) - 34 : cellX(spot.bucket) - 176,
        y: onRow ? ROW_Y - 46 : laneY(spot.lane) + 6,
        width: onRow ? CELL_W + 68 : 166,
        height: 24,
        title: `${opts.probe.label} ${onRow ? "↓" : "→"}`,
        tone: opts.probe.tone,
      });
    }
  }

  return { nodes, edges };
}

const CAT: Entry = { key: '"cat"', value: "9", bucket: 3 };
const DOG: Entry = { key: '"dog"', value: "4", bucket: 6 };
const OX: Entry = { key: '"ox"', value: "1", bucket: 3 };

const stats = (keys: number, comparisons?: number) => [
  { label: "keys", value: String(keys) },
  { label: "load factor", value: (keys / BUCKETS).toFixed(2) },
  ...(comparisons === undefined ? [] : [{ label: "key comparisons", value: String(comparisons) }]),
];

const frames: VizFrame[] = [
  {
    label: "The array",
    caption:
      "A hash map is an array — here, eight buckets. Nothing is sorted and nothing is searched; the whole trick is computing which cell a key belongs in.",
    codeLines: [1],
    stats: stats(0),
    ...scene({ entries: [] }),
  },
  {
    label: 'put "cat"',
    caption:
      'put("cat", 9). The key is a string, so it has no index of its own. Something has to turn it into one.',
    codeLines: [6],
    stats: stats(0),
    ...scene({ entries: [], chip: { key: '"cat"', value: "9", at: "in" } }),
  },
  {
    label: "Hash it",
    caption:
      'hash("cat") is a big arbitrary integer; % 8 folds it into the range of the array. Same key in, same index out, every single time — that is the only property the map relies on.',
    codeLines: [3, 4],
    stats: stats(0),
    ...scene({
      entries: [],
      chip: { key: '"cat"', value: "9", at: "hash" },
      hashText: 'hash("cat") = 92…41 → 3',
      hashTo: 3,
      focus: ["hash"],
    }),
  },
  {
    label: "Store",
    caption:
      "Bucket 3 is empty, so the pair is written there. One hash, one array index, one write — no scanning, which is where O(1) comes from.",
    codeLines: [7, 12],
    stats: stats(1),
    ...scene({ entries: [CAT], focus: [slotId(3)] }),
  },
  {
    label: 'put "dog"',
    caption:
      'put("dog", 4) hashes to 6. A different bucket, so it cannot interact with "cat" at all — inserts into different buckets are completely independent.',
    codeLines: [7, 12],
    stats: stats(2),
    ...scene({ entries: [CAT, DOG], hashText: 'hash("dog") = 17…08 → 6', hashTo: 6, focus: [slotId(6)] }),
  },
  {
    label: "Collision",
    caption:
      'put("ox", 1) also hashes to 3. Two keys want one cell. With 2⁶⁴ possible keys and 8 buckets this is not a bug to avoid, it is arithmetic — collisions are guaranteed.',
    codeLines: [7, 8],
    stats: stats(2),
    ...scene({
      entries: [CAT, DOG],
      chip: { key: '"ox"', value: "1", at: { bucket: 3, lane: 1 }, tone: "red", state: "pulsing" },
      hashText: 'hash("ox") = 44…13 → 3',
      hashTo: 3,
      pulse: [slotId(3)],
      tones: { [slotId(3)]: "red" },
    }),
  },
  {
    label: "Chain",
    caption:
      'Separate chaining resolves it: the bucket is a list, and "ox" is appended behind "cat". The write is still O(1) — but the bucket now costs a walk to read.',
    codeLines: [12],
    stats: stats(3),
    ...scene({ entries: [CAT, DOG, OX], focus: [entryId(OX.key)] }),
  },
  {
    label: 'get "ox"',
    caption:
      'get("ox") starts identically: hash the key, land on bucket 3. This step does not care whether the map holds three keys or three million.',
    codeLines: [15],
    stats: stats(3, 0),
    ...scene({
      entries: [CAT, DOG, OX],
      hashText: 'hash("ox") = 44…13 → 3',
      hashTo: 3,
      focus: ["hash", slotId(3)],
      dim: [slotId(0), slotId(1), slotId(2), slotId(4), slotId(5), slotId(6), slotId(7)],
    }),
  },
  {
    label: "Compare",
    caption:
      'Inside the bucket, keys are compared one by one — the index narrowed the search, it did not finish it. "cat" ≠ "ox", so walk to the next link.',
    codeLines: [15, 16],
    stats: stats(3, 1),
    ...scene({
      entries: [CAT, DOG, OX],
      focus: [slotId(3)],
      tones: { [slotId(3)]: "red" },
      dim: [slotId(0), slotId(1), slotId(2), slotId(4), slotId(5), slotId(6), slotId(7)],
      probe: { key: CAT.key, label: '"cat" ≠ "ox"', tone: "red" },
    }),
  },
  {
    label: "Found",
    caption:
      '"ox" == "ox" → return 1. Two comparisons instead of eight bucket scans. A hash map is fast because the hash throws away almost all the candidates before any comparing starts.',
    codeLines: [17],
    stats: stats(3, 2),
    ...scene({
      entries: [CAT, DOG, OX],
      focus: [entryId(OX.key)],
      dim: [slotId(0), slotId(1), slotId(2), slotId(4), slotId(5), slotId(6), slotId(7)],
      probe: { key: OX.key, label: "match, return 1", tone: "green" },
    }),
  },
  {
    label: "Resize",
    caption:
      "Three keys in eight buckets: load factor 0.38. Once it passes about 0.75 the array doubles and every key is rehashed — O(n), but paid once per doubling, which is why inserts are quoted as amortized O(1).",
    codeLines: [1],
    stats: stats(3, 2),
    ...scene({ entries: [CAT, DOG, OX], hashText: "load 0.38 — resize at 0.75" }),
  },
];

export const hashTableViz: Viz = {
  width: 872,
  height: 336,
  legend: [
    { tone: "violet", label: "hash" },
    { tone: "amber", label: "key in flight" },
    { tone: "green", label: "stored pair" },
    { tone: "red", label: "collision / mismatch" },
  ],
  code: {
    language: "python",
    source: `buckets = [[] for _ in range(8)]

def index(key):
    return hash(key) % len(buckets)

def put(key, value):
    b = buckets[index(key)]
    for i, (k, _) in enumerate(b):
        if k == key:
            b[i] = (key, value)
            return
    b.append((key, value))

def get(key):
    for k, v in buckets[index(key)]:
        if k == key:
            return v
    raise KeyError(key)`,
  },
  frames,
};
