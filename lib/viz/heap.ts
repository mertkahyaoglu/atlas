import { note, opBox } from "./layout";
import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * Binary heap, shown as a tree and as the array that actually stores it.
 * Nodes are keyed by value, so a sift swap animates as two values trading
 * places rather than as text changing inside fixed boxes.
 */

/** Slot i of a complete binary tree, laid out by hand so the levels line up. */
const SLOT = [
  { x: 354, y: 40 },
  { x: 174, y: 130 },
  { x: 534, y: 130 },
  { x: 84, y: 220 },
  { x: 264, y: 220 },
  { x: 444, y: 220 },
  { x: 624, y: 220 },
  { x: 36, y: 300 },
];

const NODE_W = 96;
const NODE_H = 36;
const ARRAY_Y = 360;
const ARRAY_W = 80;
const ARRAY_PITCH = 88;

const arrayX = (i: number) => 24 + i * ARRAY_PITCH;

interface SceneOpts {
  heap: number[];
  /** Indices being compared or swapped this frame. */
  focus?: number[];
  /** Index that breaks the heap property right now. */
  broken?: number;
  /** Value that has left the heap — drawn to one side as the result. */
  popped?: number;
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { heap, focus = [], broken, popped } = opts;

  const toneFor = (i: number): VizTone =>
    i === broken ? "red" : focus.includes(i) ? "blue" : i === 0 ? "green" : "neutral";

  const nodes: VizNode[] = [
    opBox("state", 24, 12, 300, "heap", opts.stateText, opts.stateTone ?? "violet"),
    note("note:tree", 24, 92, "tree view"),
    note("note:array", 24, ARRAY_Y - 22, "array view — the actual storage"),
    ...heap.flatMap((value, i) => [
      {
        id: `v:${value}`,
        shape: "box" as const,
        x: SLOT[i].x,
        y: SLOT[i].y,
        width: NODE_W,
        height: NODE_H,
        title: String(value),
        tone: toneFor(i),
        state: (i === broken || focus.includes(i) ? "active" : undefined) as "active" | undefined,
      },
      {
        id: `a:${value}`,
        shape: "cell" as const,
        x: arrayX(i),
        y: ARRAY_Y,
        width: ARRAY_W,
        height: NODE_H,
        index: String(i),
        title: String(value),
        tone: toneFor(i),
        state: (i === broken || focus.includes(i) ? "active" : undefined) as "active" | undefined,
      },
    ]),
  ];

  if (popped !== undefined) {
    nodes.push({
      id: "popped",
      shape: "chip",
      x: 560,
      y: 12,
      width: 160,
      height: 36,
      title: `pop → ${popped}`,
      tone: "green",
      state: "active",
    });
  }

  const edges: VizEdge[] = [];
  heap.forEach((value, i) => {
    for (const child of [2 * i + 1, 2 * i + 2]) {
      if (child >= heap.length) continue;
      edges.push({
        id: `e:${value}-${heap[child]}`,
        source: `v:${value}`,
        target: `v:${heap[child]}`,
        sourceSide: "b",
        targetSide: "t",
        state: focus.includes(i) && focus.includes(child) ? "active" : undefined,
      });
    }
  });

  return { nodes, edges };
}

const BASE = [2, 5, 8, 9, 6, 12, 10];

const frames: VizFrame[] = [
  {
    label: "What it is",
    caption:
      "A min-heap: a complete binary tree where every parent is smaller than its children. That is a much weaker promise than sorted — only the root is guaranteed to be the minimum, and siblings are in no order at all.",
    codeLines: [1],
    stats: [{ label: "min", value: "2" }],
    ...scene({ heap: BASE, stateText: "root = min, siblings unordered" }),
  },
  {
    label: "It is an array",
    caption:
      "There are no pointers. The tree is an array read by arithmetic: the children of index i sit at 2i+1 and 2i+2, and the parent is at (i−1)//2. Complete shape is what makes that indexing valid.",
    codeLines: [1, 16],
    stats: [{ label: "children of i", value: "2i+1, 2i+2" }],
    ...scene({ heap: BASE, focus: [1, 3, 4], stateText: "index 1 → children 3 and 4", stateTone: "teal" }),
  },
  {
    label: "Push 3",
    caption:
      "Insert at the end — the only place that keeps the tree complete. 3 lands under 9, which breaks the property immediately: a parent is now larger than its child.",
    codeLines: [3, 4, 5],
    stats: [{ label: "size", value: "8" }],
    ...scene({ heap: [...BASE, 3], broken: 7, stateText: "append 3 at index 7 → 9 > 3", stateTone: "red" }),
  },
  {
    label: "Sift up",
    caption: "Swap it with its parent. 3 is now above 9, and the only place the property can still be violated is one level higher.",
    codeLines: [6, 7, 8],
    stats: [{ label: "swaps", value: "1" }],
    ...scene({
      heap: [2, 5, 8, 3, 6, 12, 10, 9],
      focus: [1, 3],
      stateText: "swap with 9 → compare against 5",
      stateTone: "blue",
    }),
  },
  {
    label: "Stop early",
    caption:
      "One more swap puts 3 under 2, and 2 < 3, so the climb stops. At most one swap per level: log n work, not n.",
    codeLines: [6, 7],
    stats: [{ label: "swaps", value: "2" }, { label: "bound", value: "log₂ 8 = 3" }],
    ...scene({
      heap: [2, 3, 8, 5, 6, 12, 10, 9],
      focus: [0, 1],
      stateText: "2 < 3 → property restored",
      stateTone: "green",
    }),
  },
  {
    label: "Pop the min",
    caption:
      "Removing the minimum is reading the root — the easy part. Filling the hole is the work: the last element is moved up to the root, which almost certainly breaks the property.",
    codeLines: [10, 11, 14],
    stats: [{ label: "returned", value: "2" }],
    ...scene({
      heap: [9, 3, 8, 5, 6, 12, 10],
      broken: 0,
      popped: 2,
      stateText: "last element 9 moved to the root",
      stateTone: "red",
    }),
  },
  {
    label: "Sift down",
    caption:
      "Swap with the smaller child, not just any child — swapping with the larger one would leave that child above its sibling and break the property again.",
    codeLines: [16, 17, 18, 19],
    stats: [{ label: "swaps", value: "1" }],
    ...scene({
      heap: [3, 9, 8, 5, 6, 12, 10],
      focus: [0, 1],
      stateText: "children 3 and 8 → swap with 3",
      stateTone: "blue",
    }),
  },
  {
    label: "Restored",
    caption:
      "One more level down and 9 sits above 6 and nothing else — a valid heap again, back to where this started. Push and pop are mirror images: one climbs, one descends, both O(log n).",
    codeLines: [20, 21],
    stats: [{ label: "swaps", value: "2" }],
    ...scene({ heap: BASE, stateText: "heap property holds everywhere", stateTone: "green" }),
  },
  {
    label: "Not sorted",
    caption:
      "The array is still not in order, and that is the point — maintaining full order would cost more than most problems need. Pay O(log n) per element for the minimum, rather than O(n log n) up front for all of them.",
    codeLines: [11],
    stats: [{ label: "array", value: "2 5 8 9 6 12 10" }],
    ...scene({ heap: BASE, focus: [4, 5, 6], stateText: "6 before 12 before 10 — no global order", stateTone: "amber" }),
  },
  {
    label: "Top-k",
    caption:
      "The reason heaps come up in interviews: keeping the k best of a stream. Hold a heap of size k, push each element, pop when it overflows — O(n log k) time and O(k) space, no matter how long the stream is.",
    codeLines: [3, 10],
    stats: [
      { label: "time", value: "O(n log k)" },
      { label: "space", value: "O(k)" },
    ],
    ...scene({ heap: BASE, focus: [0], stateText: "keep k, evict the worst → O(n log k)", stateTone: "teal" }),
  },
  {
    label: "Build in O(n)",
    caption:
      "Heapifying an existing array is O(n), not O(n log n) — sifting down from the last parent means most nodes are near the bottom and barely move. Pushing n elements one at a time is the slower way to get the same thing.",
    codeLines: [16, 22],
    stats: [
      { label: "heapify", value: "O(n)" },
      { label: "n pushes", value: "O(n log n)" },
    ],
    ...scene({ heap: BASE, stateText: "sift down from the last parent backwards", stateTone: "teal" }),
  },
];

export const heapViz: Viz = {
  width: 744,
  height: 420,
  legend: [
    { tone: "green", label: "root — the minimum" },
    { tone: "blue", label: "being compared" },
    { tone: "red", label: "property broken" },
  ],
  code: {
    language: "python",
    source: `parent = lambda i: (i - 1) // 2

def push(heap, value):
    heap.append(value)
    i = len(heap) - 1
    while i and heap[parent(i)] > heap[i]:
        swap(heap, i, parent(i))
        i = parent(i)

def pop(heap):
    top, last = heap[0], heap.pop()
    if not heap:
        return top
    heap[0], i = last, 0
    n = len(heap)
    while (c := 2 * i + 1) < n:
        r = c + 1
        if r < n and heap[r] < heap[c]:
            c = r              # smaller child
        if heap[i] <= heap[c]:
            break
        swap(heap, i, c)
        i = c
    return top`,
  },
  frames,
};
