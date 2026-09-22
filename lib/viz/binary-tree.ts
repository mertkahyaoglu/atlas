import { note, opBox } from "./layout";
import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * Depth-first traversal of a binary search tree: where the recursion is at any
 * moment, what it has emitted, and why inorder comes out sorted.
 */

interface TreeNode {
  value: number;
  x: number;
  y: number;
  left?: number;
  right?: number;
}

/** Index 0 is the root. Coordinates are hand-placed so the tree reads as a tree. */
const TREE: TreeNode[] = [
  { value: 8, x: 294, y: 40, left: 1, right: 2 },
  { value: 3, x: 114, y: 130, left: 3, right: 4 },
  { value: 10, x: 474, y: 130, left: 5, right: 6 },
  { value: 1, x: 24, y: 220 },
  { value: 6, x: 204, y: 220 },
  { value: 9, x: 384, y: 220 },
  { value: 14, x: 564, y: 220 },
];

const NODE_W = 96;
const NODE_H = 36;
const OUT_Y = 300;

interface SceneOpts {
  /** Node the recursion is sitting on. */
  current?: number;
  /** Nodes whose call frames are open — the path from the root. */
  path?: number[];
  /** Values emitted so far, in order. */
  output: number[];
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { current, path = [], output } = opts;
  const visited = new Set(output);

  const nodes: VizNode[] = [
    opBox("state", 24, 16, 260, "call stack", opts.stateText, opts.stateTone ?? "violet"),
    note("note:out", 24, OUT_Y - 22, "output, in visit order"),
    ...TREE.map((node, i) => ({
      id: `node:${i}`,
      shape: "box" as const,
      x: node.x,
      y: node.y,
      width: NODE_W,
      height: NODE_H,
      title: String(node.value),
      tone: (i === current ? "blue" : visited.has(node.value) ? "green" : path.includes(i) ? "amber" : "neutral") as VizTone,
      state: (i === current || path.includes(i) ? "active" : visited.has(node.value) ? undefined : "dimmed") as
        | "active"
        | "dimmed"
        | undefined,
    })),
    ...output.map((value, i) => ({
      id: `out:${value}`,
      shape: "chip" as const,
      x: 24 + i * 80,
      y: OUT_Y,
      width: 68,
      height: 30,
      title: String(value),
      tone: "green" as const,
      state: "active" as const,
    })),
  ];

  const edges: VizEdge[] = [];
  TREE.forEach((node, i) => {
    for (const child of [node.left, node.right]) {
      if (child === undefined) continue;
      edges.push({
        id: `e:${i}-${child}`,
        source: `node:${i}`,
        target: `node:${child}`,
        sourceSide: "b",
        targetSide: "t",
        state: path.includes(i) && (path.includes(child) || child === current) ? "active" : undefined,
      });
    }
  });

  return { nodes, edges };
}

const stats = (depth: number, emitted: number) => [
  { label: "stack depth", value: String(depth) },
  { label: "emitted", value: `${emitted} / 7` },
];

const frames: VizFrame[] = [
  {
    label: "The tree",
    caption:
      "A binary search tree: every value in a left subtree is smaller than its parent, every value on the right is larger. A node knows only its children, so the only way through is to recurse.",
    codeLines: [1, 2],
    stats: stats(0, 0),
    ...scene({ output: [], stateText: "root = 8, height 2" }),
  },
  {
    label: "Go left",
    caption:
      "Inorder means left subtree, then the node, then the right subtree. So nothing is emitted yet — the recursion descends to 3, and then to 1, before anything can be printed.",
    codeLines: [3, 4],
    stats: stats(3, 0),
    ...scene({ current: 3, path: [0, 1], output: [], stateText: "visit(8) → visit(3) → visit(1)" }),
  },
  {
    label: "Emit 1",
    caption:
      "Node 1 has no left child, so the first thing that can be emitted is 1 itself — the leftmost node in the tree, which is the smallest value.",
    codeLines: [5],
    stats: stats(3, 1),
    ...scene({ current: 3, path: [0, 1], output: [1], stateText: "1 has no left child → emit 1", stateTone: "green" }),
  },
  {
    label: "Back up",
    caption:
      "1 has no right child either, so its frame returns and control lands back in 3 — right after the left call. Now 3 is emitted.",
    codeLines: [5, 6],
    stats: stats(2, 2),
    ...scene({ current: 1, path: [0], output: [1, 3], stateText: "return to 3 → emit 3", stateTone: "green" }),
  },
  {
    label: "Right child",
    caption: "Then 3's right subtree: node 6, a leaf, emitted immediately. The left half of the tree is now complete.",
    codeLines: [6],
    stats: stats(3, 3),
    ...scene({ current: 4, path: [0, 1], output: [1, 3, 6], stateText: "visit(6) → emit 6", stateTone: "green" }),
  },
  {
    label: "The root",
    caption:
      "Only with the whole left subtree finished does the root get emitted. That ordering is exactly why inorder produces sorted output on a BST.",
    codeLines: [5],
    stats: stats(1, 4),
    ...scene({ current: 0, path: [], output: [1, 3, 6, 8], stateText: "left done → emit 8", stateTone: "green" }),
  },
  {
    label: "Right subtree",
    caption: "The same procedure on the right half: descend to 9, emit it, return to 10 and emit that.",
    codeLines: [6, 4, 5],
    stats: stats(3, 6),
    ...scene({ current: 5, path: [0, 2], output: [1, 3, 6, 8, 9, 10], stateText: "visit(10) → visit(9) → emit 9, 10", stateTone: "green" }),
  },
  {
    label: "Done",
    caption:
      "14 finishes the walk. Every node was entered once and left once — O(n) time — and the deepest the stack ever got was the height of the tree.",
    codeLines: [6],
    stats: stats(0, 7),
    ...scene({ output: [1, 3, 6, 8, 9, 10, 14], stateText: "sorted: 1 3 6 8 9 10 14", stateTone: "green" }),
  },
  {
    label: "Three orders",
    caption:
      "Moving the emit line is the only difference between the three depth-first orders. Before the children: preorder, 8 3 1 6 10 9 14 — good for copying a tree. After both: postorder, 1 6 3 9 14 10 8 — good for freeing or for computing heights from the bottom up.",
    codeLines: [4, 5, 6],
    stats: [{ label: "orders", value: "pre · in · post" }],
    ...scene({ output: [1, 3, 6, 8, 9, 10, 14], stateText: "emit before / between / after the recursive calls", stateTone: "teal" }),
  },
  {
    label: "Or breadth-first",
    caption:
      "Replace the stack with a queue and the walk becomes level order: 8, then 3 10, then 1 6 9 14. Same code shape, different container — and the right answer whenever the question mentions levels or shortest path.",
    codeLines: [8, 9, 10, 11, 12],
    stats: [{ label: "space", value: "O(width)" }],
    ...scene({ output: [8], stateText: "queue = [3, 10] → level by level", stateTone: "teal" }),
  },
  {
    label: "The cost",
    caption:
      "O(n) time for any traversal. Space is O(h), the height — about log n if the tree is balanced, but n for a degenerate one-sided tree, which is when recursion overflows the stack and an explicit one is safer.",
    codeLines: [3],
    stats: [
      { label: "time", value: "O(n)" },
      { label: "space", value: "O(h)" },
    ],
    ...scene({ output: [1, 3, 6, 8, 9, 10, 14], stateText: "balanced h ≈ log n  ·  skewed h = n", stateTone: "amber" }),
  },
];

export const binaryTreeViz: Viz = {
  width: 684,
  height: 350,
  legend: [
    { tone: "blue", label: "current node" },
    { tone: "amber", label: "open call frame" },
    { tone: "green", label: "emitted" },
  ],
  code: {
    language: "python",
    source: `def inorder(node, out):
    if not node:
        return
    inorder(node.left, out)
    out.append(node.value)
    inorder(node.right, out)

def level_order(root):
    queue, out = deque([root]), []
    while queue:
        node = queue.popleft()
        out.append(node.value)
        kids = (node.left, node.right)
        queue.extend(c for c in kids if c)
    return out`,
  },
  frames,
};
