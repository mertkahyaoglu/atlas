import { arrayRow, cellX, note, opBox } from "./layout";
import type { Viz, VizFrame, VizNode, VizTone } from "./types";

/**
 * House robber, bottom-up: the recursion tree that repeats itself, the table
 * that stops it repeating, and the two variables that replace the table.
 */

const HOUSES = [5, 1, 8, 4, 9, 2];

const HOUSE_Y = 140;
const TABLE_Y = 236;

/** The overlapping calls the naive recursion makes — drawn once, above the table. */
const CALLS = [
  { id: "c:5", label: "f(5)", x: 232, y: 16 },
  { id: "c:4", label: "f(4)", x: 128, y: 16 },
  { id: "c:3a", label: "f(3)", x: 24, y: 16 },
  { id: "c:3b", label: "f(3)", x: 336, y: 16 },
  { id: "c:2", label: "f(2)", x: 440, y: 16 },
];

interface SceneOpts {
  /** dp[i] values computed so far; undefined means "not filled yet". */
  table: (number | undefined)[];
  /** Index being computed. */
  current?: number;
  /** Indices the current cell reads from. */
  reads?: number[];
  showCalls?: boolean;
  /** Duplicated calls to flag red. */
  duplicate?: string[];
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[] } {
  const { table, current, reads = [], showCalls, duplicate = [] } = opts;

  const nodes: VizNode[] = [
    opBox("state", 24, 66, 260, "dp[i]", opts.stateText, opts.stateTone ?? "violet"),
    note("note:houses", 24, HOUSE_Y - 22, "houses — cannot rob two in a row"),
    note("note:table", 24, TABLE_Y - 22, "dp[i] = best takings up to house i"),
    ...arrayRow(HOUSES, {
      y: HOUSE_Y,
      idPrefix: "h",
      decorate: (i) => ({
        tone: i === current ? "blue" : "neutral",
        state: i === current ? "active" : i > (current ?? HOUSES.length) ? "dimmed" : undefined,
      }),
    }),
    ...arrayRow(
      table.map((value) => (value === undefined ? "·" : String(value))),
      {
        y: TABLE_Y,
        idPrefix: "dp",
        decorate: (i) => ({
          tone: i === current ? "green" : reads.includes(i) ? "amber" : "neutral",
          state:
            i === current || reads.includes(i) ? "active" : table[i] === undefined ? "dimmed" : undefined,
        }),
      },
    ),
  ];

  if (showCalls) {
    nodes.push(
      note("note:calls", 24, 0, "naive recursion — the same call, again and again", 420),
      ...CALLS.map((call) => ({
        id: call.id,
        shape: "chip" as const,
        x: call.x,
        y: call.y,
        width: 96,
        height: 30,
        title: call.label,
        tone: (duplicate.includes(call.id) ? "red" : "neutral") as VizTone,
        state: (duplicate.includes(call.id) ? "active" : "dimmed") as "active" | "dimmed",
      })),
    );
  }

  return { nodes };
}

const T = (...values: (number | undefined)[]) => [...values, ...Array(6 - values.length).fill(undefined)];

const frames: VizFrame[] = [
  {
    label: "The problem",
    caption:
      "Six houses, and robbing two adjacent ones trips the alarm. Maximise the total. Every house is a yes/no choice, so brute force is 2ⁿ paths — and most of them repeat the same sub-problems.",
    codeLines: [1, 2, 3],
    stats: [{ label: "brute force", value: "2ⁿ" }],
    ...scene({ table: T(), stateText: "choose a subset, no two adjacent" }),
  },
  {
    label: "The repetition",
    caption:
      "Recursion on \"best from house i onwards\" calls f(3) from two different branches, and f(2) from four. The tree is exponential, but the number of distinct calls is only n — that gap is what dynamic programming exploits.",
    codeLines: [4, 5],
    stats: [{ label: "distinct calls", value: "6" }],
    ...scene({ table: T(), showCalls: true, duplicate: ["c:3a", "c:3b"], stateText: "f(3) computed twice", stateTone: "red" }),
  },
  {
    label: "The recurrence",
    caption:
      "At each house there are exactly two options: skip it and keep dp[i−1], or rob it and add it to dp[i−2]. dp[i] is the better of the two — one line that defines the whole table.",
    codeLines: [6, 14],
    stats: [{ label: "choices", value: "2 per house" }],
    ...scene({ table: T(), stateText: "dp[i] = max(dp[i−1], dp[i−2] + house[i])", stateTone: "teal" }),
  },
  {
    label: "Base cases",
    caption:
      "With one house you take it: dp[0] = 5. With two, you take the better single one, not both — 5 beats 1. Getting these two wrong is the most common way the whole table ends up off.",
    codeLines: [9, 10],
    stats: [{ label: "filled", value: "2 / 6" }],
    ...scene({ table: T(5, 5), current: 1, stateText: "dp[0] = 5, dp[1] = max(5, 1) = 5", stateTone: "green" }),
  },
  {
    label: "dp[2]",
    caption:
      "Skip house 2 and keep 5, or rob it for 8 and add dp[0] = 5, giving 13. Robbing wins. Note that it reads only two earlier cells — never the whole history.",
    codeLines: [13, 14],
    stats: [{ label: "filled", value: "3 / 6" }],
    ...scene({ table: T(5, 5, 13), current: 2, reads: [0, 1], stateText: "max(5, 5 + 8) = 13", stateTone: "green" }),
  },
  {
    label: "dp[3]",
    caption: "Skip and keep 13, or rob 4 on top of dp[1] = 5 for 9. Skipping wins, so the value carries forward unchanged.",
    codeLines: [13, 14],
    stats: [{ label: "filled", value: "4 / 6" }],
    ...scene({ table: T(5, 5, 13, 13), current: 3, reads: [1, 2], stateText: "max(13, 5 + 4) = 13", stateTone: "green" }),
  },
  {
    label: "dp[4]",
    caption: "Robbing 9 on top of dp[2] = 13 gives 22, beating the 13 from skipping. Each cell is one comparison, and each is computed exactly once.",
    codeLines: [13, 14],
    stats: [{ label: "filled", value: "5 / 6" }],
    ...scene({ table: T(5, 5, 13, 13, 22), current: 4, reads: [2, 3], stateText: "max(13, 13 + 9) = 22", stateTone: "green" }),
  },
  {
    label: "dp[5]",
    caption:
      "The last house adds 2 to dp[3] = 13, which loses to 22. The answer is the final cell — 22, from houses 0, 2 and 4.",
    codeLines: [14, 15],
    stats: [{ label: "answer", value: "22" }],
    ...scene({ table: T(5, 5, 13, 13, 22, 22), current: 5, reads: [3, 4], stateText: "max(22, 13 + 2) = 22", stateTone: "green" }),
  },
  {
    label: "Exponential to linear",
    caption:
      "Six cells, one comparison each: O(n) time and O(n) space, replacing 2ⁿ recursive calls. Nothing was solved twice, which is the entire mechanism — memoisation top-down, or a table bottom-up.",
    codeLines: [11, 13, 14],
    stats: [
      { label: "time", value: "O(n)" },
      { label: "space", value: "O(n)" },
    ],
    ...scene({ table: T(5, 5, 13, 13, 22, 22), stateText: "each sub-problem solved once", stateTone: "teal" }),
  },
  {
    label: "Drop the table",
    caption:
      "Each cell reads only the two before it, so the table is unnecessary — two rolling variables hold everything the recurrence needs. O(1) space, and the follow-up interviewers reach for once the table version works.",
    codeLines: [17, 18, 20, 21],
    stats: [{ label: "space", value: "O(1)" }],
    ...scene({
      table: T(5, 5, 13, 13, 22, 22),
      reads: [3, 4],
      stateText: "keep prev and prev2 — nothing else",
      stateTone: "teal",
    }),
  },
];

export const dynamicProgrammingViz: Viz = {
  width: cellX(5) + 96 + 24,
  height: 300,
  legend: [
    { tone: "blue", label: "house being decided" },
    { tone: "green", label: "cell just computed" },
    { tone: "amber", label: "cells it reads" },
    { tone: "red", label: "repeated sub-problem" },
  ],
  code: {
    language: "python",
    source: `def rob_naive(h, i=0):
    if i >= len(h):
        return 0
    skip = rob_naive(h, i + 1)
    take = h[i] + rob_naive(h, i + 2)
    return max(skip, take)     # 2ⁿ calls

def rob(h):
    dp = [0] * len(h)
    dp[0] = h[0]
    for i in range(1, len(h)):
        prev2 = dp[i - 2] if i > 1 else 0
        take = h[i] + prev2
        dp[i] = max(dp[i - 1], take)
    return dp[-1]

def rob_rolling(h):
    prev2 = prev = 0
    for value in h:
        best = max(prev, prev2 + value)
        prev2, prev = prev, best
    return prev`,
  },
  frames,
};
