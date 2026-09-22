import { note, opBox } from "./layout";
import type { Viz, VizFrame, VizNode, VizTone } from "./types";

/**
 * Merging overlapping intervals: sorting by start, then one pass where each
 * interval either extends the last merged one or begins a new one.
 */

interface Interval {
  id: string;
  start: number;
  end: number;
}

/** Deliberately unsorted, so the first step has something to do. */
const INPUT: Interval[] = [
  { id: "c", start: 8, end: 10 },
  { id: "a", start: 1, end: 3 },
  { id: "d", start: 9, end: 12 },
  { id: "b", start: 2, end: 6 },
  { id: "e", start: 15, end: 18 },
];

const SORTED = ["a", "b", "c", "d", "e"];

const UNIT = 36;
const AXIS_X = 40;
const INPUT_Y = 90;
const ROW_PITCH = 32;
const MERGED_Y = INPUT_Y + 5 * ROW_PITCH + 26;
const BAR_H = 26;

const at = (value: number) => AXIS_X + value * UNIT;
const span = (start: number, end: number) => ({ x: at(start), width: (end - start) * UNIT });

interface SceneOpts {
  /** Order the input bars are drawn in — unsorted at first, sorted afterwards. */
  order: string[];
  /** Interval being examined. */
  current?: string;
  /** Intervals already folded into the output. */
  consumed?: string[];
  /** The output so far, as [start, end] pairs. */
  merged: [number, number][];
  /** Index of the output bar being extended this frame. */
  extending?: number;
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[] } {
  const { order, current, consumed = [], merged, extending } = opts;

  const nodes: VizNode[] = [
    opBox("state", 24, 16, 380, "merge", opts.stateText, opts.stateTone ?? "violet"),
    note("note:input", 24, INPUT_Y - 22, "input intervals"),
    note("note:merged", 24, MERGED_Y - 22, "output"),
    // A ruler, so "overlap" is something you can see rather than infer.
    ...[0, 3, 6, 9, 12, 15, 18].map((tick) => ({
      id: `tick:${tick}`,
      shape: "note" as const,
      x: at(tick) - 12,
      y: MERGED_Y + BAR_H + 10,
      width: 40,
      height: 16,
      title: String(tick),
    })),
  ];

  order.forEach((id, row) => {
    const interval = INPUT.find((item) => item.id === id)!;
    const tone: VizTone = id === current ? "blue" : consumed.includes(id) ? "green" : "neutral";
    nodes.push({
      id: `in:${id}`,
      shape: "cell",
      ...span(interval.start, interval.end),
      y: INPUT_Y + row * ROW_PITCH,
      height: BAR_H,
      title: `${interval.start}–${interval.end}`,
      tone,
      state: id === current ? "active" : consumed.includes(id) ? undefined : "dimmed",
    });
  });

  merged.forEach(([start, end], i) => {
    nodes.push({
      id: `out:${i}`,
      shape: "cell",
      ...span(start, end),
      y: MERGED_Y,
      height: BAR_H,
      title: `${start}–${end}`,
      tone: i === extending ? "amber" : "green",
      state: "active",
    });
  });

  return { nodes };
}

const frames: VizFrame[] = [
  {
    label: "Unsorted",
    caption:
      "Five intervals, given in no particular order. Comparing every pair to find the overlaps is O(n²), and it still leaves the problem of merging chains where A touches B and B touches C.",
    codeLines: [1],
    stats: [{ label: "intervals", value: "5" }],
    ...scene({ order: INPUT.map((i) => i.id), merged: [], stateText: "8–10, 1–3, 9–12, 2–6, 15–18" }),
  },
  {
    label: "Sort by start",
    caption:
      "Sorting by start time is the whole algorithm. Afterwards, any interval that overlaps the one being built must start before it ends — so a single left-to-right pass is enough.",
    codeLines: [2],
    stats: [{ label: "cost", value: "O(n log n)" }],
    ...scene({ order: SORTED, merged: [], stateText: "1–3, 2–6, 8–10, 9–12, 15–18", stateTone: "teal" }),
  },
  {
    label: "First interval",
    caption: "The earliest interval opens the output. Nothing can overlap it from the left, because nothing starts earlier.",
    codeLines: [3, 4, 5],
    stats: [{ label: "output", value: "1" }],
    ...scene({ order: SORTED, current: "a", consumed: [], merged: [[1, 3]], stateText: "output = [1–3]" }),
  },
  {
    label: "Overlap",
    caption:
      "2–6 starts at 2, before the open interval ends at 3, so they overlap. Merging means stretching the end to the later of the two — 6 — not replacing it.",
    codeLines: [6, 7],
    stats: [{ label: "output", value: "1" }],
    ...scene({
      order: SORTED,
      current: "b",
      consumed: ["a"],
      merged: [[1, 6]],
      extending: 0,
      stateText: "2 ≤ 3 → extend end to max(3, 6) = 6",
      stateTone: "amber",
    }),
  },
  {
    label: "No overlap",
    caption:
      "8–10 starts after the open interval ends at 6. There is a real gap, so the merged interval is finished and a new one opens. This is the only branch in the loop.",
    codeLines: [8, 9],
    stats: [{ label: "output", value: "2" }],
    ...scene({
      order: SORTED,
      current: "c",
      consumed: ["a", "b"],
      merged: [
        [1, 6],
        [8, 10],
      ],
      stateText: "8 > 6 → close 1–6, open 8–10",
      stateTone: "green",
    }),
  },
  {
    label: "Extend again",
    caption: "9–12 starts inside 8–10, so the open interval stretches to 12. Note it is compared against the merged end, not against the original 8–10.",
    codeLines: [6, 7],
    stats: [{ label: "output", value: "2" }],
    ...scene({
      order: SORTED,
      current: "d",
      consumed: ["a", "b", "c"],
      merged: [
        [1, 6],
        [8, 12],
      ],
      extending: 1,
      stateText: "9 ≤ 10 → extend end to 12",
      stateTone: "amber",
    }),
  },
  {
    label: "Done",
    caption:
      "15–18 is clear of everything, so it opens the third and final interval. Five intervals in, three out, in one pass over the sorted list.",
    codeLines: [8, 9, 10],
    stats: [{ label: "output", value: "3" }],
    ...scene({
      order: SORTED,
      current: "e",
      consumed: ["a", "b", "c", "d"],
      merged: [
        [1, 6],
        [8, 12],
        [15, 18],
      ],
      stateText: "result = [1–6], [8–12], [15–18]",
      stateTone: "green",
    }),
  },
  {
    label: "The test",
    caption:
      "Two intervals overlap when a.start ≤ b.end and b.start ≤ a.end. Sorting collapses that to one comparison, because the first half is already guaranteed. Whether touching endpoints count as overlapping is a question worth asking out loud.",
    codeLines: [6],
    stats: [{ label: "comparison", value: "start ≤ open end" }],
    ...scene({
      order: SORTED,
      consumed: ["a", "b", "c", "d", "e"],
      merged: [
        [1, 6],
        [8, 12],
        [15, 18],
      ],
      stateText: "sorted → only one side needs checking",
      stateTone: "teal",
    }),
  },
  {
    label: "The cost",
    caption:
      "O(n log n) for the sort and O(n) for the pass, so the sort dominates. If the input arrives sorted — by timestamp, by booking time — the whole thing is linear, which is worth saying when the problem hints at it.",
    codeLines: [2, 3],
    stats: [
      { label: "time", value: "O(n log n)" },
      { label: "space", value: "O(n)" },
    ],
    ...scene({
      order: SORTED,
      consumed: ["a", "b", "c", "d", "e"],
      merged: [
        [1, 6],
        [8, 12],
        [15, 18],
      ],
      stateText: "sort dominates · pre-sorted input → O(n)",
      stateTone: "teal",
    }),
  },
];

export const intervalsViz: Viz = {
  width: at(19) + 40,
  height: MERGED_Y + BAR_H + 44,
  legend: [
    { tone: "blue", label: "current interval" },
    { tone: "amber", label: "being extended" },
    { tone: "green", label: "merged output" },
  ],
  code: {
    language: "python",
    source: `def merge(intervals):
    intervals.sort(key=lambda i: i[0])
    out = []
    for start, end in intervals:
        if out and start <= out[-1][1]:
            # overlap: stretch it
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return out`,
  },
  frames,
};
