import type { Viz, VizFrame, VizNode, VizTone } from "./types";

/**
 * Longest substring without repeating characters: the variable-size window.
 *
 * The teaching point is that `left` only ever moves forward. Each frame is the
 * window's two edges plus the map of last-seen indices that lets the left edge
 * jump instead of crawl.
 */

const S = ["a", "b", "c", "a", "b", "c", "b", "b"];

const ROW_X = 24;
const ROW_Y = 140;
const CELL_W = 96;
const CELL_H = 36;
const CELL_PITCH = CELL_W + 8;
const LEFT_MARKER_Y = ROW_Y + CELL_H + 10;
const RIGHT_MARKER_Y = LEFT_MARKER_Y + 26;
const MAP_Y = 248;

const cellX = (i: number) => ROW_X + i * CELL_PITCH;
const cellId = (i: number) => `cell:${i}`;

interface SceneOpts {
  left?: number;
  right?: number;
  /** The line inside the window box: `"abc" · len 3`. */
  windowText: string;
  windowTone?: VizTone;
  best: number;
  bestText: string;
  /** An earlier copy of the character just read — the reason the window shrinks. */
  duplicate?: number;
  /** char → last index seen, drawn as the map the code actually keeps. */
  lastSeen?: [string, number][];
}

function scene(opts: SceneOpts): { nodes: VizNode[] } {
  const { left, right, duplicate } = opts;
  const inWindow = (i: number) => left !== undefined && right !== undefined && i >= left && i <= right;

  const nodes: VizNode[] = [
    { id: "note:string", shape: "note", x: ROW_X, y: 112, width: 300, height: 16, title: 's = "abcabcbb"' },
    {
      id: "best",
      shape: "op",
      x: ROW_X,
      y: 20,
      width: 176,
      height: 52,
      title: `best = ${opts.best}`,
      detail: opts.bestText,
      tone: "green",
    },
    {
      id: "window",
      shape: "op",
      x: 300,
      y: 20,
      width: 340,
      height: 52,
      title: "window s[left..right]",
      detail: opts.windowText,
      tone: opts.windowTone ?? "teal",
      state: "active",
    },
  ];

  S.forEach((ch, i) => {
    const tone: VizTone = i === duplicate ? "red" : inWindow(i) ? "teal" : "neutral";
    nodes.push({
      id: cellId(i),
      shape: "cell",
      x: cellX(i),
      y: ROW_Y,
      width: CELL_W,
      height: CELL_H,
      index: String(i),
      title: ch,
      tone,
      state: i === duplicate ? "pulsing" : inWindow(i) ? "active" : left === undefined ? undefined : "dimmed",
    });
  });

  // Stacked rather than side by side: a one-character window puts both edges on
  // the same cell, and two labels in one slot would overlap.
  for (const [name, index, tone, y] of [
    ["left", left, "amber", LEFT_MARKER_Y],
    ["right", right, "blue", RIGHT_MARKER_Y],
  ] as const) {
    if (index === undefined) continue;
    nodes.push({
      id: `marker:${name}`,
      shape: "marker",
      x: cellX(index),
      y,
      width: CELL_W,
      height: 22,
      title: `↑ ${name}`,
      tone,
    });
  }

  if (opts.lastSeen) {
    nodes.push({ id: "note:map", shape: "note", x: ROW_X, y: MAP_Y + 6, width: 150, height: 16, title: "last seen" });
    opts.lastSeen.forEach(([ch, index], i) => {
      nodes.push({
        id: `map:${ch}`,
        shape: "chip",
        x: 150 + i * 92,
        y: MAP_Y,
        width: 84,
        height: 28,
        title: `${ch} → ${index}`,
        tone: inWindow(index) ? "teal" : "neutral",
        state: inWindow(index) ? "active" : "dimmed",
      });
    });
  }

  return { nodes };
}

const stats = (left: number, right: number, best: number) => [
  { label: "size", value: String(right - left + 1) },
  { label: "best", value: String(best) },
];

const frames: VizFrame[] = [
  {
    label: "The question",
    caption:
      "Longest run of characters with no repeat. Checking every substring is O(n²) of them, each costing O(n) to validate — so the brute force is cubic before it even starts.",
    codeLines: [1, 2, 3],
    stats: [{ label: "substrings", value: "36" }],
    ...scene({ windowText: "no window yet", best: 0, bestText: '""' }),
  },
  {
    label: "Open at 0",
    caption:
      'Both edges start on "a". A window of one character is always valid, and the rule from here is simple: push right as far as it stays valid.',
    codeLines: [4, 8, 9, 10],
    stats: stats(0, 0, 1),
    ...scene({ left: 0, right: 0, windowText: '"a"  ·  len 1', best: 1, bestText: '"a"', lastSeen: [["a", 0]] }),
  },
  {
    label: "Grow",
    caption: '"b" has not been seen inside the window, so right moves on and the window grows to two.',
    codeLines: [4, 8, 9, 10],
    stats: stats(0, 1, 2),
    ...scene({
      left: 0,
      right: 1,
      windowText: '"ab"  ·  len 2',
      best: 2,
      bestText: '"ab"',
      lastSeen: [
        ["a", 0],
        ["b", 1],
      ],
    }),
  },
  {
    label: "Grow again",
    caption: 'Same for "c". Three distinct characters, and best is updated on every step the window is valid.',
    codeLines: [4, 8, 9, 10],
    stats: stats(0, 2, 3),
    ...scene({
      left: 0,
      right: 2,
      windowText: '"abc"  ·  len 3',
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ],
    }),
  },
  {
    label: "Repeat",
    caption:
      'Right reads "a" — already in the window, at index 0. The window is now invalid, and no amount of growing fixes it: the left edge has to move.',
    codeLines: [5, 6],
    stats: stats(0, 3, 3),
    ...scene({
      left: 0,
      right: 3,
      duplicate: 0,
      windowText: '"abca" — "a" repeats',
      windowTone: "red",
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ],
    }),
  },
  {
    label: "Jump left",
    caption:
      "Left jumps to just past the old \"a\" — not one step, straight there. The map of last-seen indices is what makes that jump possible, and it is why the scan stays linear.",
    codeLines: [7, 8, 9, 10],
    stats: stats(1, 3, 3),
    ...scene({
      left: 1,
      right: 3,
      windowText: '"bca"  ·  len 3',
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 3],
        ["b", 1],
        ["c", 2],
      ],
    }),
  },
  {
    label: "Again",
    caption: '"b" repeats from index 1, so left moves to 2. Note what did not happen: left never went backwards.',
    codeLines: [5, 6, 7],
    stats: stats(2, 4, 3),
    ...scene({
      left: 2,
      right: 4,
      windowText: '"cab"  ·  len 3',
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 3],
        ["b", 4],
        ["c", 2],
      ],
    }),
  },
  {
    label: "Steady state",
    caption:
      "The window slides along at length three — growing by one on the right, losing one on the left. Best does not change, because nothing longer is valid.",
    codeLines: [5, 6, 7],
    stats: stats(3, 5, 3),
    ...scene({
      left: 3,
      right: 5,
      windowText: '"abc"  ·  len 3',
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 3],
        ["b", 4],
        ["c", 5],
      ],
    }),
  },
  {
    label: "Big jump",
    caption:
      'The second "b" at index 6 repeats the one at 4, so left leaps from 3 to 5 — two cells retired by a single comparison.',
    codeLines: [5, 6, 7],
    stats: stats(5, 6, 3),
    ...scene({
      left: 5,
      right: 6,
      windowText: '"cb"  ·  len 2',
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 3],
        ["b", 6],
        ["c", 5],
      ],
    }),
  },
  {
    label: "Collapse",
    caption:
      'The last "b" repeats the one right before it, collapsing the window to a single character. Valid again — shorter, but the answer already recorded is safe.',
    codeLines: [5, 6, 7],
    stats: stats(7, 7, 3),
    ...scene({
      left: 7,
      right: 7,
      windowText: '"b"  ·  len 1',
      best: 3,
      bestText: '"abc"',
      lastSeen: [
        ["a", 3],
        ["b", 7],
        ["c", 5],
      ],
    }),
  },
  {
    label: "Why O(n)",
    caption:
      "Right visited each index once, and left only ever moved forward — at most n moves between them. Every substring was accounted for without a single one being re-read: O(n) time, O(k) space for the map.",
    codeLines: [11],
    stats: [
      { label: "answer", value: "3" },
      { label: "index moves", value: "≤ 2n" },
    ],
    ...scene({
      left: 7,
      right: 7,
      windowText: "each index enters and leaves once",
      windowTone: "green",
      best: 3,
      bestText: '"abc"',
    }),
  },
];

export const slidingWindowViz: Viz = {
  width: 872,
  height: 290,
  legend: [
    { tone: "amber", label: "left" },
    { tone: "blue", label: "right" },
    { tone: "teal", label: "inside the window" },
    { tone: "red", label: "repeat — window invalid" },
  ],
  code: {
    language: "python",
    source: `def longest_unique(s):
    last = {}
    left = best = 0
    for right, ch in enumerate(s):
        prev = last.get(ch, -1)
        if prev >= left:
            left = prev + 1
        last[ch] = right
        size = right - left + 1
        best = max(best, size)
    return best`,
  },
  frames,
};
