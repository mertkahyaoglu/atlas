import { arrayRow, cellX, note, opBox, pointer, CELL_H } from "./layout";
import type { Viz, VizFrame, VizNode, VizTone } from "./types";

/**
 * Binary search: halving as an elimination argument, and the boundary form
 * that answers "the first index where the predicate is true".
 */

const NUMS = [2, 5, 8, 12, 16, 23, 38, 56];
const TARGET = 23;

const ROW_Y = 132;
const LO_Y = ROW_Y + CELL_H + 10;
const HI_Y = LO_Y + 26;
const MID_Y = HI_Y + 26;

interface SceneOpts {
  lo?: number;
  hi?: number;
  mid?: number;
  compareText: string;
  compareTone?: VizTone;
  found?: number;
}

function scene(opts: SceneOpts): { nodes: VizNode[] } {
  const { lo, hi, mid, found } = opts;
  const live = (i: number) => lo === undefined || hi === undefined || (i >= lo && i <= hi);

  const nodes: VizNode[] = [
    note("note:array", 24, 104, "sorted nums[8]"),
    opBox("target", 24, 20, 176, `target = ${TARGET}`, "return its index, or -1", "teal"),
    opBox("compare", 300, 20, 360, "nums[mid] vs target", opts.compareText, opts.compareTone ?? "violet"),
    ...arrayRow(NUMS, {
      y: ROW_Y,
      decorate: (i) => ({
        tone: i === found ? "green" : i === mid ? "violet" : live(i) ? "neutral" : "neutral",
        state: i === found || i === mid ? "active" : live(i) ? undefined : "dimmed",
      }),
    }),
  ];

  if (lo !== undefined) nodes.push(pointer("lo", lo, "amber", LO_Y));
  if (hi !== undefined) nodes.push(pointer("hi", hi, "blue", HI_Y));
  if (mid !== undefined) nodes.push(pointer("mid", mid, "violet", MID_Y));

  return { nodes };
}

const stats = (lo: number, hi: number, step: number) => [
  { label: "candidates", value: String(hi - lo + 1) },
  { label: "comparisons", value: String(step) },
];

const frames: VizFrame[] = [
  {
    label: "Sorted input",
    caption:
      "Eight sorted values and a target of 23. A linear scan costs up to eight comparisons. Sorted order buys something stronger: one comparison can rule out half the array at once.",
    codeLines: [1, 2],
    stats: [{ label: "candidates", value: "8" }],
    ...scene({ compareText: "8 candidates" }),
  },
  {
    label: "Whole range",
    caption:
      "lo and hi bracket the range that could still hold the answer. The invariant to hold onto: if the target exists, its index is inside [lo, hi] — always.",
    codeLines: [2, 3],
    stats: stats(0, 7, 0),
    ...scene({ lo: 0, hi: 7, compareText: "search space = [0, 7]" }),
  },
  {
    label: "Probe the middle",
    caption:
      "mid = lo + (hi − lo) // 2 = 3. Written this way rather than (lo + hi) // 2, which can overflow in a fixed-width integer language — a favourite follow-up.",
    codeLines: [4],
    stats: stats(0, 7, 0),
    ...scene({ lo: 0, hi: 7, mid: 3, compareText: "mid = 0 + (7 − 0) // 2 = 3" }),
  },
  {
    label: "Too small",
    caption:
      "nums[3] = 12 < 23. Everything at or below index 3 is therefore also below the target — sorted order says so. Four indices die on one comparison.",
    codeLines: [5, 8, 9],
    stats: stats(0, 7, 1),
    ...scene({ lo: 0, hi: 7, mid: 3, compareText: "12 < 23 → answer is to the right", compareTone: "amber" }),
  },
  {
    label: "Right half",
    caption: "lo jumps to mid + 1. The search space is [4, 7]: half the array, gone, and it never needs revisiting.",
    codeLines: [9, 3],
    stats: stats(4, 7, 1),
    ...scene({ lo: 4, hi: 7, compareText: "search space = [4, 7]" }),
  },
  {
    label: "Probe again",
    caption: "mid = 4 + (7 − 4) // 2 = 5, and nums[5] = 23. The same rule applied to a range half the size.",
    codeLines: [4, 5],
    stats: stats(4, 7, 1),
    ...scene({ lo: 4, hi: 7, mid: 5, compareText: "mid = 5 → nums[5] = 23" }),
  },
  {
    label: "Found",
    caption:
      "Two comparisons instead of six. Each step cut the candidate set in half, so the cost is the number of halvings — log₂(8) = 3 in the worst case.",
    codeLines: [5, 6],
    stats: stats(5, 5, 2),
    ...scene({ lo: 4, hi: 7, mid: 5, found: 5, compareText: "23 == 23 → return 5", compareTone: "green" }),
  },
  {
    label: "The loop bound",
    caption:
      "`while lo <= hi` with `hi = mid - 1` is the exact-match form. Mixing it with `while lo < hi` or forgetting the ±1 gives an infinite loop or a missed single element — the two bugs that show up in interviews.",
    codeLines: [3, 8, 10],
    stats: [{ label: "worst case", value: "log₂ 8 = 3" }],
    ...scene({ lo: 5, hi: 5, mid: 5, found: 5, compareText: "lo <= hi, mid ± 1 — never re-test mid", compareTone: "green" }),
  },
  {
    label: "Boundary form",
    caption:
      "Most real uses are not \"find x\" but \"find the first index where a predicate turns true\" — first ≥ target, minimum feasible capacity, first bad version. Keep mid when it satisfies the predicate, and the loop converges on the boundary.",
    codeLines: [13, 14, 15, 16, 17],
    stats: [{ label: "invariant", value: "answer ∈ [lo, hi]" }],
    ...scene({ lo: 0, hi: 7, compareText: "first index with nums[i] ≥ target", compareTone: "teal" }),
  },
  {
    label: "The real condition",
    caption:
      "Sortedness is not the requirement — a monotone predicate is. Any array where the answer is false, false, …, true, true can be halved this way, which is why binary search also applies to answers, not just arrays.",
    codeLines: [13, 16],
    stats: [{ label: "needs", value: "monotone predicate" }],
    ...scene({ compareText: "F F F F T T T T → binary search applies", compareTone: "teal" }),
  },
];

export const binarySearchViz: Viz = {
  width: cellX(7) + 96 + 24,
  height: MID_Y + 40,
  legend: [
    { tone: "amber", label: "lo" },
    { tone: "blue", label: "hi" },
    { tone: "violet", label: "mid" },
    { tone: "green", label: "answer" },
  ],
  code: {
    language: "python",
    source: `def search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = lo + (hi - lo) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

def first_true(lo, hi, ok):
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if ok(mid):
            hi = mid          # keep mid
        else:
            lo = mid + 1
    return lo`,
  },
  frames,
};
