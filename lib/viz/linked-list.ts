import { note, opBox, CELL_H } from "./layout";
import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * Reversing a singly linked list in place: three pointers, and the one saved
 * reference that keeps the rest of the list reachable.
 */

const VALUES = [1, 2, 3, 4, 5];

const NODE_X = 160;
const NODE_PITCH = 128;
const NODE_W = 96;
const ROW_Y = 128;
const PREV_Y = ROW_Y + CELL_H + 10;
const CURR_Y = PREV_Y + 26;
const NEXT_Y = CURR_Y + 26;

const nodeX = (i: number) => NODE_X + i * NODE_PITCH;
const nodeId = (i: number) => `n:${i}`;

interface SceneOpts {
  /** How many links, counting from the head, have been flipped to point left. */
  reversed: number;
  prev?: number;
  curr?: number;
  next?: number;
  stateText: string;
  stateTone?: VizTone;
  /** The link rewritten in this frame, drawn as the active edge. */
  flipping?: number;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { reversed, prev, curr, next, flipping } = opts;

  const nodes: VizNode[] = [
    note("note:list", NODE_X, 100, "singly linked list"),
    opBox("state", NODE_X, 16, 460, "prev · curr · next", opts.stateText, opts.stateTone ?? "violet"),
    {
      id: "null",
      shape: "chip",
      x: 24,
      y: ROW_Y,
      width: 80,
      height: CELL_H,
      title: "None",
      tone: "neutral",
      state: "dimmed",
    },
    ...VALUES.map((value, i) => ({
      id: nodeId(i),
      shape: "box" as const,
      x: nodeX(i),
      y: ROW_Y,
      width: NODE_W,
      height: CELL_H,
      title: String(value),
      detail: i === curr ? "curr" : undefined,
      tone: (i === curr ? "blue" : i === prev ? "amber" : i === next ? "violet" : "neutral") as VizTone,
      state: i === curr || i === prev || i === next ? ("active" as const) : undefined,
    })),
  ];

  const edges: VizEdge[] = [];
  // Flipped links point back toward the head — and the first one points at None.
  for (let i = 0; i < reversed; i += 1) {
    edges.push({
      id: `e:${i}back`,
      source: nodeId(i),
      target: i === 0 ? "null" : nodeId(i - 1),
      sourceSide: "l",
      targetSide: "r",
      state: flipping === i ? "active" : undefined,
    });
  }
  // The untouched tail still points forward.
  for (let i = reversed; i < VALUES.length - 1; i += 1) {
    edges.push({ id: `e:${i}fwd`, source: nodeId(i), target: nodeId(i + 1), state: flipping === i ? "active" : undefined });
  }

  for (const [name, index, tone, y] of [
    ["prev", prev, "amber", PREV_Y],
    ["curr", curr, "blue", CURR_Y],
    ["next", next, "violet", NEXT_Y],
  ] as const) {
    if (index === undefined) continue;
    nodes.push({
      id: `marker:${name}`,
      shape: "marker",
      x: nodeX(index),
      y,
      width: NODE_W,
      height: 22,
      title: `↑ ${name}`,
      tone,
    });
  }

  return { nodes, edges };
}

const stats = (flipped: number) => [
  { label: "links flipped", value: `${flipped} / 4` },
  { label: "extra space", value: "O(1)" },
];

const frames: VizFrame[] = [
  {
    label: "The list",
    caption:
      "A singly linked list: each node knows only the next one. Reversing it means rewriting every link — and the danger is that overwriting a link is how you lose the rest of the list.",
    codeLines: [1, 2],
    stats: stats(0),
    ...scene({ reversed: 0, stateText: "1 → 2 → 3 → 4 → 5 → None" }),
  },
  {
    label: "Three pointers",
    caption:
      "prev starts at None — it will be the new tail's target — and curr at the head. Every step needs exactly these two, plus a temporary for what comes next.",
    codeLines: [2, 3],
    stats: stats(0),
    ...scene({ reversed: 0, curr: 0, stateText: "prev = None, curr = node(1)" }),
  },
  {
    label: "Save next",
    caption:
      "Before touching curr.next, save it. This is the line people drop, and the result is a one-element list: the moment the link is overwritten, nodes 2 to 5 are unreachable.",
    codeLines: [5],
    stats: stats(0),
    ...scene({ reversed: 0, curr: 0, next: 1, stateText: "next = curr.next  ← the line that matters", stateTone: "amber" }),
  },
  {
    label: "Flip",
    caption: "Now curr.next can point backwards at prev, which is None. Node 1 is the new tail, and the link is final.",
    codeLines: [6],
    stats: stats(1),
    ...scene({ reversed: 1, curr: 0, next: 1, flipping: 0, stateText: "curr.next = prev → 1 → None", stateTone: "green" }),
  },
  {
    label: "Advance",
    caption:
      "Shift the window forward: prev becomes the node just finished, curr becomes the saved next. The list is now two pieces — the reversed prefix and the untouched suffix.",
    codeLines: [7, 8],
    stats: stats(1),
    ...scene({ reversed: 1, prev: 0, curr: 1, stateText: "prev = node(1), curr = node(2)" }),
  },
  {
    label: "Again",
    caption: "Same three moves on node 2: save, flip, advance. Nothing about the step depends on where it is in the list.",
    codeLines: [5, 6, 7, 8],
    stats: stats(2),
    ...scene({ reversed: 2, prev: 1, curr: 2, flipping: 1, stateText: "2 → 1 → None  ·  3 → 4 → 5 still forward" }),
  },
  {
    label: "Halfway",
    caption:
      "The invariant is visible now: everything left of curr is reversed and ends at None; everything from curr on is the original list, untouched and still reachable.",
    codeLines: [4, 5, 6],
    stats: stats(3),
    ...scene({ reversed: 3, prev: 2, curr: 3, flipping: 2, stateText: "3 → 2 → 1 → None  ·  curr = node(4)" }),
  },
  {
    label: "Last node",
    caption: "Node 5 flips, and the saved next is None — which is what ends the loop on the following check.",
    codeLines: [5, 6, 7, 8],
    stats: stats(4),
    ...scene({ reversed: 5, prev: 3, curr: 4, flipping: 4, stateText: "5 → 4 → 3 → 2 → 1 → None", stateTone: "green" }),
  },
  {
    label: "New head",
    caption:
      "curr is None, so the loop exits — and prev is standing on the last node processed, which is the new head. Returning curr here is the other classic bug; it returns None.",
    codeLines: [4, 9],
    stats: stats(4),
    ...scene({ reversed: 5, prev: 4, stateText: "return prev → head is node(5)", stateTone: "green" }),
  },
  {
    label: "Cost",
    caption:
      "One pass, three pointers: O(n) time, O(1) space. The recursive version is also O(n) time but O(n) space for the call stack — worth naming, because the follow-up is usually about deep lists.",
    codeLines: [4, 9],
    stats: [
      { label: "time", value: "O(n)" },
      { label: "space", value: "O(1)" },
    ],
    ...scene({ reversed: 5, prev: 4, stateText: "iterative O(1) space  ·  recursive O(n) stack", stateTone: "teal" }),
  },
];

export const linkedListViz: Viz = {
  width: nodeX(VALUES.length - 1) + NODE_W + 24,
  height: NEXT_Y + 40,
  legend: [
    { tone: "amber", label: "prev" },
    { tone: "blue", label: "curr" },
    { tone: "violet", label: "next (saved)" },
    { tone: "green", label: "link rewritten" },
  ],
  code: {
    language: "python",
    source: `def reverse(head):
    prev = None
    curr = head
    while curr:
        next = curr.next   # save it first
        curr.next = prev   # flip the link
        prev = curr        # advance
        curr = next
    return prev        # not curr: curr is None`,
  },
  frames,
};
