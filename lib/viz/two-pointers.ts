import type { Viz, VizFrame, VizNode, VizTone } from "./types";

/**
 * Opposite-ends two pointers on a sorted array: why moving one pointer is
 * allowed to throw away every pair that used it.
 *
 * The drawing is a pure function of where `lo` and `hi` are, so a frame is
 * little more than two indices and the sentence that justifies the move.
 */

const NUMS = [2, 3, 5, 8, 11, 14, 18, 22];
const TARGET = 19;

const ROW_X = 24;
const ROW_Y = 140;
const CELL_W = 96;
const CELL_H = 36;
const CELL_PITCH = CELL_W + 8;
const MARKER_Y = ROW_Y + CELL_H + 10;

const cellX = (i: number) => ROW_X + i * CELL_PITCH;
const cellId = (i: number) => `cell:${i}`;

interface SceneOpts {
  lo?: number;
  hi?: number;
  /** The line inside the sum box: `2 + 22 = 24 → too big`. */
  sumText: string;
  sumTone?: VizTone;
  /** Both indices of the answer, once it is found. */
  found?: [number, number];
}

function scene(opts: SceneOpts): { nodes: VizNode[] } {
  const { lo, hi, found } = opts;
  const nodes: VizNode[] = [
    { id: "note:array", shape: "note", x: ROW_X, y: 112, width: 260, height: 16, title: "sorted nums[8]" },
    {
      id: "target",
      shape: "op",
      x: ROW_X,
      y: 20,
      width: 176,
      height: 52,
      title: `target = ${TARGET}`,
      detail: "find the two indices",
      tone: "teal",
    },
    {
      id: "sum",
      shape: "op",
      x: 300,
      y: 20,
      width: 340,
      height: 52,
      title: "nums[lo] + nums[hi]",
      detail: opts.sumText,
      tone: opts.sumTone ?? "violet",
      state: "active",
    },
  ];

  NUMS.forEach((value, i) => {
    // Outside the window the index has been proven useless, not merely skipped.
    const retired = lo !== undefined && hi !== undefined && (i < lo || i > hi);
    const tone: VizTone = found?.includes(i)
      ? "green"
      : i === lo
        ? "amber"
        : i === hi
          ? "blue"
          : "neutral";
    nodes.push({
      id: cellId(i),
      shape: "cell",
      x: cellX(i),
      y: ROW_Y,
      width: CELL_W,
      height: CELL_H,
      index: String(i),
      title: String(value),
      tone,
      state: retired ? "dimmed" : found?.includes(i) || i === lo || i === hi ? "active" : undefined,
    });
  });

  for (const [name, index, tone] of [
    ["lo", lo, "amber"],
    ["hi", hi, "blue"],
  ] as const) {
    if (index === undefined) continue;
    nodes.push({
      id: `marker:${name}`,
      shape: "marker",
      x: cellX(index),
      y: MARKER_Y,
      width: CELL_W,
      height: 22,
      title: `↑ ${name}`,
      tone,
    });
  }

  return { nodes };
}

/** Pairs the scan has not ruled out yet — the number the algorithm is shrinking. */
const pairsLeft = (lo: number, hi: number) => {
  const width = hi - lo + 1;
  return (width * (width - 1)) / 2;
};

const stats = (lo: number, hi: number, checked: number) => [
  { label: "checked", value: String(checked) },
  { label: "pairs left", value: String(pairsLeft(lo, hi)) },
];

const frames: VizFrame[] = [
  {
    label: "Sorted input",
    caption:
      "Eight sorted values, and a target of 19. Brute force would test all 28 pairs. The order in this array is what makes a cheaper answer possible — unsorted, none of what follows holds.",
    codeLines: [1],
    stats: [{ label: "pairs", value: "28" }],
    ...scene({ sumText: "28 pairs to rule out", sumTone: "violet" }),
  },
  {
    label: "Both ends",
    caption:
      "Start at the extremes: lo on the smallest value, hi on the largest. Their sum is the largest total still reachable from lo, and the smallest still reachable from hi.",
    codeLines: [2, 3],
    stats: stats(0, 7, 0),
    ...scene({ lo: 0, hi: 7, sumText: "2 + 22 = 24" }),
  },
  {
    label: "Too big",
    caption:
      "24 > 19. Pairing 22 with the smallest value available already overshoots, so no pair containing 22 can work. That retires the whole column — one comparison, seven pairs gone.",
    codeLines: [4, 7, 8],
    stats: stats(0, 7, 1),
    ...scene({ lo: 0, hi: 7, sumText: "2 + 22 = 24  >  19 — drop 22", sumTone: "red" }),
  },
  {
    label: "hi moves in",
    caption:
      "hi steps left to 18, and the same test runs again: 20 is still over. 18 cannot pair with anything either, because everything it could pair with is at least 2.",
    codeLines: [4, 7, 8],
    stats: stats(0, 6, 2),
    ...scene({ lo: 0, hi: 6, sumText: "2 + 18 = 20  >  19 — drop 18", sumTone: "red" }),
  },
  {
    label: "Too small",
    caption:
      "16 < 19. Now the argument flips: 2 paired with the largest value left is still short, so 2 is the one that cannot appear in any answer. lo moves right.",
    codeLines: [4, 9, 10],
    stats: stats(0, 5, 3),
    ...scene({ lo: 0, hi: 5, sumText: "2 + 14 = 16  <  19 — drop 2", sumTone: "amber" }),
  },
  {
    label: "lo moves in",
    caption:
      "17 is short as well, by the same reasoning — 3 is now the value that can never reach the target. Each comparison eliminates exactly one index, from whichever end was proven impossible.",
    codeLines: [4, 9, 10],
    stats: stats(1, 5, 4),
    ...scene({ lo: 1, hi: 5, sumText: "3 + 14 = 17  <  19 — drop 3", sumTone: "amber" }),
  },
  {
    label: "Found",
    caption:
      "5 + 14 = 19. Five comparisons instead of 28, and the pointers never went backwards — every index was visited at most once.",
    codeLines: [5, 6],
    stats: stats(2, 5, 5),
    ...scene({ lo: 2, hi: 5, sumText: "5 + 14 = 19  =  target", sumTone: "green", found: [2, 5] }),
  },
  {
    label: "Why O(n)",
    caption:
      "Each step moves one pointer one place inward and never out, so the two of them take at most n steps between them. That is the whole cost: O(n) time, O(1) space, no extra structure.",
    codeLines: [3],
    stats: [
      { label: "comparisons", value: "5" },
      { label: "brute force", value: "28" },
    ],
    ...scene({ lo: 2, hi: 5, sumText: "lo + hi move n times total → O(n)", sumTone: "green", found: [2, 5] }),
  },
  {
    label: "The catch",
    caption:
      "Take the sorting away and the elimination step has nothing to stand on: a big value early in the array says nothing about what follows it. On unsorted input this becomes a hash map problem instead.",
    codeLines: [1],
    stats: [{ label: "requires", value: "sorted" }],
    ...scene({ sumText: "unsorted → no elimination → use a hash map", sumTone: "red" }),
  },
];

export const twoPointersViz: Viz = {
  width: 872,
  height: 230,
  legend: [
    { tone: "amber", label: "lo" },
    { tone: "blue", label: "hi" },
    { tone: "green", label: "answer" },
    { tone: "neutral", label: "dimmed = eliminated" },
  ],
  code: {
    language: "python",
    source: `def two_sum_sorted(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        total = nums[lo] + nums[hi]
        if total == target:
            return [lo, hi]
        if total > target:
            hi -= 1
        else:
            lo += 1
    return []`,
  },
  frames,
};
