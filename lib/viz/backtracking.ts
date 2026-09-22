import { note, opBox } from "./layout";
import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * Subsets of [1, 2, 3] as a decision tree: include or skip each element.
 * Nodes are keyed by their decision string, so the drawing is "which decisions
 * has the search made so far" and nothing else.
 */

const NUMS = [1, 2, 3];
const DEPTH = NUMS.length;

const LEAF_X = (i: number) => 24 + i * 104;
const NODE_W = 96;
const NODE_H = 36;
const RESULT_Y = 348;

/** A node is the sequence of include/skip decisions taken to reach it. */
function position(decisions: string) {
  const depth = decisions.length;
  const span = 2 ** (DEPTH - depth);
  const start = parseInt(decisions || "0", 2) * span;
  return { x: (LEAF_X(start) + LEAF_X(start + span - 1)) / 2, y: 36 + depth * 82 };
}

const subsetOf = (decisions: string) =>
  NUMS.filter((_, i) => decisions[i] === "1").join(",") || "{ }";

interface SceneOpts {
  /** Decision strings for every node the search has opened. */
  opened: string[];
  /** The decision string the search is sitting on. */
  current?: string;
  /** Subsets collected so far. */
  results: string[];
  /** A node the search has just returned from — the undo step. */
  undone?: string;
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { opened, current, results, undone } = opts;
  const onPath = (id: string) => current !== undefined && current.startsWith(id);

  const nodes: VizNode[] = [
    opBox("state", 24, 8, 340, "path", opts.stateText, opts.stateTone ?? "violet"),
    note("note:tree", 24, RESULT_Y - 24, "subsets collected"),
    ...opened.map((id) => {
      const at = position(id);
      return {
        id: `n:${id || "root"}`,
        shape: "cell" as const,
        x: at.x,
        y: at.y,
        width: NODE_W,
        height: NODE_H,
        title: subsetOf(id),
        tone: (id === current ? "blue" : id === undone ? "red" : onPath(id) ? "amber" : "neutral") as VizTone,
        state: (id === current || id === undone || onPath(id) ? "active" : "dimmed") as "active" | "dimmed",
      };
    }),
    ...results.map((subset, i) => ({
      id: `r:${subset}`,
      shape: "chip" as const,
      x: 24 + i * 104,
      y: RESULT_Y,
      width: 96,
      height: 30,
      title: subset,
      tone: "green" as const,
      state: "active" as const,
    })),
  ];

  const edges: VizEdge[] = opened
    .filter((id) => id.length > 0)
    .map((id) => {
      const parent = id.slice(0, -1);
      return {
        id: `e:${id}`,
        source: `n:${parent || "root"}`,
        target: `n:${id}`,
        sourceSide: "b" as const,
        targetSide: "t" as const,
        label: id.endsWith("1") ? `+${NUMS[id.length - 1]}` : "skip",
        state: (onPath(id) ? "active" : undefined) as "active" | undefined,
      };
    });

  return { nodes, edges };
}

const opened = (...ids: string[]) => ids;

const frames: VizFrame[] = [
  {
    label: "The choice",
    caption:
      "Every subset of [1, 2, 3] is a sequence of three yes/no decisions: take this element, or skip it. That makes the whole answer a binary tree with 2³ leaves, and the algorithm a walk over it.",
    codeLines: [1, 2],
    stats: [{ label: "leaves", value: "8" }],
    ...scene({ opened: opened(""), current: "", results: [], stateText: "path = [ ], index 0" }),
  },
  {
    label: "Take 1",
    caption:
      "Go down the include branch: 1 joins the path. Nothing is recorded yet — a subset is only complete once every element has been decided.",
    codeLines: [7, 8],
    stats: [{ label: "depth", value: "1" }],
    ...scene({ opened: opened("", "1"), current: "1", results: [], stateText: "path = [1]" }),
  },
  {
    label: "Take 2, take 3",
    caption: "Keep choosing. At depth three every element has an answer, so the path is a finished subset and gets recorded.",
    codeLines: [4, 5],
    stats: [{ label: "found", value: "1" }],
    ...scene({
      opened: opened("", "1", "11", "111"),
      current: "111",
      results: ["1,2,3"],
      stateText: "path = [1,2,3] → record",
      stateTone: "green",
    }),
  },
  {
    label: "Undo 3",
    caption:
      "Return from the leaf and remove 3 from the path. This is the backtrack — without it, the path keeps growing and every later branch is contaminated by decisions that no longer apply.",
    codeLines: [9],
    stats: [{ label: "found", value: "1" }],
    ...scene({
      opened: opened("", "1", "11", "111"),
      current: "11",
      undone: "111",
      results: ["1,2,3"],
      stateText: "pop 3 → path = [1,2]",
      stateTone: "red",
    }),
  },
  {
    label: "Skip 3",
    caption: "The other branch of the same node: leave 3 out. Same prefix, different tail — this is where the sharing comes from.",
    codeLines: [10],
    stats: [{ label: "found", value: "2" }],
    ...scene({
      opened: opened("", "1", "11", "111", "110"),
      current: "110",
      results: ["1,2,3", "1,2"],
      stateText: "path = [1,2] → record",
      stateTone: "green",
    }),
  },
  {
    label: "Back up two",
    caption:
      "Both children of [1,2] are done, so the search returns further, undoing 2 as well. The path shrinks back to [1] and the skip branch opens.",
    codeLines: [9, 10],
    stats: [{ label: "found", value: "4" }],
    ...scene({
      opened: opened("", "1", "11", "111", "110", "10", "101", "100"),
      current: "10",
      results: ["1,2,3", "1,2", "1,3", "1"],
      stateText: "path = [1] → subtree done",
      stateTone: "amber",
    }),
  },
  {
    label: "Skip 1 entirely",
    caption:
      "The right half of the tree is everything that excludes 1. The same three decisions play out again, which is why the shape is a perfect binary tree.",
    codeLines: [10],
    stats: [{ label: "found", value: "6" }],
    ...scene({
      opened: opened("", "1", "11", "111", "110", "10", "101", "100", "0", "01", "011", "010"),
      current: "01",
      results: ["1,2,3", "1,2", "1,3", "1", "2,3", "2"],
      stateText: "path = [2] → right half",
    }),
  },
  {
    label: "All eight",
    caption:
      "Every leaf was reached exactly once, giving all 2ⁿ subsets — including the empty one, which is the path where every decision was skip.",
    codeLines: [4, 5],
    stats: [{ label: "found", value: "8" }],
    ...scene({
      opened: opened("", "1", "11", "111", "110", "10", "101", "100", "0", "01", "011", "010", "00", "001", "000"),
      results: ["1,2,3", "1,2", "1,3", "1", "2,3", "2", "3", "{ }"],
      stateText: "2³ = 8 subsets",
      stateTone: "green",
    }),
  },
  {
    label: "The template",
    caption:
      "Choose, explore, un-choose. The undo exists because the path is one shared mutable list — copy it at every node instead and you can drop the undo, at the cost of allocating on every call.",
    codeLines: [7, 8, 9],
    stats: [{ label: "pattern", value: "choose · explore · undo" }],
    ...scene({
      opened: opened("", "1", "11", "111", "110", "10", "101", "100", "0", "01", "011", "010", "00", "001", "000"),
      current: "11",
      results: ["1,2,3", "1,2", "1,3", "1", "2,3", "2", "3", "{ }"],
      stateText: "path.append → recurse → path.pop",
      stateTone: "teal",
    }),
  },
  {
    label: "Pruning",
    caption:
      "Subsets explore every branch because every branch is an answer. Most backtracking problems are not like that: N-Queens, sudoku and combination-sum reject a partial path early, and the whole subtree under it never runs. That test is where the real speed comes from.",
    codeLines: [4],
    stats: [{ label: "with pruning", value: "≪ 2ⁿ" }],
    ...scene({
      opened: opened("", "1", "11", "0", "01"),
      current: "11",
      results: [],
      stateText: "invalid prefix → skip the entire subtree",
      stateTone: "amber",
    }),
  },
  {
    label: "The cost",
    caption:
      "2ⁿ subsets, each costing O(n) to copy out: O(2ⁿ · n). Permutations are n! · n. Exponential is expected here — the output itself is exponential — so the thing to optimise is how early invalid branches die.",
    codeLines: [1, 5],
    stats: [
      { label: "subsets", value: "O(2ⁿ·n)" },
      { label: "permutations", value: "O(n!·n)" },
    ],
    ...scene({
      opened: opened("", "1", "11", "111", "110", "10", "101", "100", "0", "01", "011", "010", "00", "001", "000"),
      results: ["1,2,3", "1,2", "1,3", "1", "2,3", "2", "3", "{ }"],
      stateText: "output is exponential → so is the walk",
      stateTone: "teal",
    }),
  },
];

export const backtrackingViz: Viz = {
  width: LEAF_X(7) + NODE_W + 24,
  height: 400,
  legend: [
    { tone: "blue", label: "current node" },
    { tone: "amber", label: "on the path" },
    { tone: "red", label: "undone" },
    { tone: "green", label: "recorded" },
  ],
  code: {
    language: "python",
    source: `def subsets(nums):
    out, path = [], []
    def walk(i):
        if i == len(nums):
            out.append(path[:])    # copy the path
            return
        path.append(nums[i])   # choose
        walk(i + 1)            # explore
        path.pop()             # un-choose
        walk(i + 1)            # skip it
    walk(0)
    return out`,
  },
  frames,
};
