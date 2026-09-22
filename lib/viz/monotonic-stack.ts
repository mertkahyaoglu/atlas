import { arrayRow, note, opBox, CELL_H } from "./layout";
import type { Viz, VizFrame, VizNode, VizTone } from "./types";

/**
 * Next greater element with a monotonic stack: what the stack is actually
 * holding (indices still waiting for an answer) and why one pop per element
 * keeps a nested loop linear.
 */

const NUMS = [2, 1, 5, 6, 2, 3];

const ROW_Y = 104;
const ANSWER_Y = 186;
const STACK_X = 680;
const STACK_BASE_Y = 240;
const STACK_PITCH = 44;

interface SceneOpts {
  /** Index being read right now. */
  current?: number;
  /** Indices on the stack, bottom first. */
  stack: number[];
  /** Answers resolved so far; -1 means "nothing greater to the right". */
  answers: Record<number, number>;
  /** Index popped in this frame — it just got its answer. */
  popped?: number;
  actionText: string;
  actionTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[] } {
  const { current, stack, answers, popped } = opts;

  const nodes: VizNode[] = [
    note("note:array", 24, 76, "nums"),
    note("note:answers", 24, 160, "next greater"),
    note("note:stack", STACK_X, 40, "stack — top on top", 150),
    opBox("action", 24, 16, 420, current === undefined ? "scan" : `i = ${current}, nums[i] = ${NUMS[current]}`, opts.actionText, opts.actionTone ?? "violet"),
    ...arrayRow(NUMS, {
      y: ROW_Y,
      decorate: (i) => ({
        tone: i === current ? "blue" : i === popped ? "red" : stack.includes(i) ? "amber" : "neutral",
        state:
          i === current || i === popped ? "active" : stack.includes(i) ? "active" : i in answers ? "dimmed" : undefined,
      }),
    }),
    ...arrayRow(
      NUMS.map((_, i) => (i in answers ? String(answers[i]) : "·")),
      {
        y: ANSWER_Y,
        idPrefix: "ans",
        showIndex: false,
        decorate: (i) => ({
          tone: i === popped ? "green" : i in answers ? "green" : "neutral",
          state: i === popped ? "active" : i in answers ? undefined : "dimmed",
        }),
      },
    ),
  ];

  // Bottom of the stack sits low; each push stacks another chip above it.
  stack.forEach((index, depth) => {
    nodes.push({
      id: `stk:${index}`,
      shape: "chip",
      x: STACK_X,
      y: STACK_BASE_Y - depth * STACK_PITCH,
      width: 150,
      height: CELL_H,
      title: `i=${index}`,
      detail: `val ${NUMS[index]}`,
      tone: "amber",
      state: "active",
    });
  });

  return { nodes };
}

const stats = (pushes: number, pops: number) => [
  { label: "pushes", value: String(pushes) },
  { label: "pops", value: String(pops) },
];

const frames: VizFrame[] = [
  {
    label: "The question",
    caption:
      "For every element, find the next element to its right that is larger. The obvious solution scans forward from each index — O(n²), and most of those scans re-read the same values.",
    codeLines: [1, 2, 3],
    stats: [{ label: "brute force", value: "O(n²)" }],
    ...scene({ stack: [], answers: {}, actionText: "nothing resolved yet" }),
  },
  {
    label: "Push 2",
    caption:
      "Index 0 has no answer yet, so it goes on the stack. That is what the stack holds: indices still waiting for someone bigger to show up.",
    codeLines: [4, 8],
    stats: stats(1, 0),
    ...scene({ current: 0, stack: [0], answers: {}, actionText: "stack empty → push index 0" }),
  },
  {
    label: "Push 1",
    caption:
      "1 is smaller than the 2 below it, so it answers nothing and waits too. The stack's values now decrease from bottom to top — that ordering is the whole invariant.",
    codeLines: [5, 8],
    stats: stats(2, 0),
    ...scene({ current: 1, stack: [0, 1], answers: {}, actionText: "1 < 2 → push index 1", actionTone: "amber" }),
  },
  {
    label: "5 resolves 1",
    caption:
      "5 is greater than the value on top, so index 1's wait is over: its next greater element is 5. Pop it and record the answer.",
    codeLines: [5, 6, 7],
    stats: stats(2, 1),
    ...scene({
      current: 2,
      stack: [0],
      answers: { 1: 5 },
      popped: 1,
      actionText: "5 > 1 → pop index 1, answer = 5",
      actionTone: "green",
    }),
  },
  {
    label: "…and 0",
    caption:
      "The new top is 2, also smaller, so it pops as well. One element can resolve several waiting ones — then it takes their place on the stack.",
    codeLines: [5, 6, 7, 8],
    stats: stats(3, 2),
    ...scene({
      current: 2,
      stack: [2],
      answers: { 0: 5, 1: 5 },
      popped: 0,
      actionText: "5 > 2 → pop index 0, answer = 5, then push index 2",
      actionTone: "green",
    }),
  },
  {
    label: "6 resolves 5",
    caption: "6 pops the 5 and takes its place. Each pop is a final answer — nothing popped ever comes back.",
    codeLines: [5, 6, 7, 8],
    stats: stats(4, 3),
    ...scene({
      current: 3,
      stack: [3],
      answers: { 0: 5, 1: 5, 2: 6 },
      popped: 2,
      actionText: "6 > 5 → pop index 2, answer = 6, push index 3",
      actionTone: "green",
    }),
  },
  {
    label: "Smaller waits",
    caption: "2 is under the 6 on top, so it resolves nothing and joins the queue of waiting indices.",
    codeLines: [5, 8],
    stats: stats(5, 3),
    ...scene({
      current: 4,
      stack: [3, 4],
      answers: { 0: 5, 1: 5, 2: 6 },
      actionText: "2 < 6 → push index 4",
      actionTone: "amber",
    }),
  },
  {
    label: "Stop at the first",
    caption:
      "3 pops the 2 and then stops, because 6 is bigger. Stopping is safe precisely because the stack decreases — everything deeper is larger still.",
    codeLines: [5, 6, 7, 8],
    stats: stats(6, 4),
    ...scene({
      current: 5,
      stack: [3, 5],
      answers: { 0: 5, 1: 5, 2: 6, 4: 3 },
      popped: 4,
      actionText: "3 > 2 → pop index 4; 3 < 6 → stop, push index 5",
      actionTone: "green",
    }),
  },
  {
    label: "Leftovers",
    caption:
      "Whatever is still on the stack at the end never found anything larger — those get −1. The stack is the exact set of unanswered indices, all the way through.",
    codeLines: [9],
    stats: stats(6, 6),
    ...scene({
      stack: [],
      answers: { 0: 5, 1: 5, 2: 6, 3: -1, 4: 3, 5: -1 },
      actionText: "remaining indices 3 and 5 → −1",
      actionTone: "teal",
    }),
  },
  {
    label: "Why O(n)",
    caption:
      "There is a loop inside a loop, and it is still linear: every index is pushed exactly once and popped at most once, so the inner loop does at most n pops across the entire run.",
    codeLines: [4, 5, 8],
    stats: [
      { label: "elements", value: "6" },
      { label: "stack ops", value: "12" },
    ],
    ...scene({
      stack: [],
      answers: { 0: 5, 1: 5, 2: 6, 3: -1, 4: 3, 5: -1 },
      actionText: "each index: one push, one pop → O(n)",
      actionTone: "green",
    }),
  },
];

export const monotonicStackViz: Viz = {
  width: STACK_X + 150 + 24,
  height: 290,
  legend: [
    { tone: "blue", label: "current" },
    { tone: "amber", label: "waiting on the stack" },
    { tone: "red", label: "being popped" },
    { tone: "green", label: "answered" },
  ],
  code: {
    language: "python",
    source: `def next_greater(nums):
    out = [-1] * len(nums)
    stack = []          # indices, decreasing
    for i, value in enumerate(nums):
        while stack and nums[stack[-1]] < value:
            j = stack.pop()
            out[j] = value
        stack.append(i)
    return out`,
  },
  frames,
};
