import { note, opBox } from "./layout";
import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * A trie built one word at a time: characters live on the path, shared
 * prefixes are stored once, and "is a word" is a flag rather than a node.
 */

interface TrieSlot {
  id: string;
  label: string;
  x: number;
  y: number;
  parent?: string;
  /** The word that ends here, if any. */
  word?: string;
}

const SLOTS: TrieSlot[] = [
  { id: "root", label: "root", x: 24, y: 130 },
  { id: "c", label: "c", x: 164, y: 80, parent: "root" },
  { id: "ca", label: "a", x: 304, y: 80, parent: "c" },
  { id: "cat", label: "t", x: 444, y: 30, parent: "ca", word: "cat" },
  { id: "car", label: "r", x: 444, y: 130, parent: "ca", word: "car" },
  { id: "d", label: "d", x: 164, y: 220, parent: "root" },
  { id: "do", label: "o", x: 304, y: 220, parent: "d" },
  { id: "dog", label: "g", x: 444, y: 220, parent: "do", word: "dog" },
];

const NODE_W = 96;
const NODE_H = 36;

interface SceneOpts {
  /** Slot ids that exist in this frame. */
  present: string[];
  /** Ids on the path being walked right now. */
  path?: string[];
  /** Ids created in this frame. */
  created?: string[];
  /** Id whose word flag is the point of this frame. */
  flagged?: string;
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { present, path = [], created = [], flagged } = opts;
  const live = SLOTS.filter((slot) => present.includes(slot.id));

  const nodes: VizNode[] = [
    opBox("state", 24, 16, 380, "trie", opts.stateText, opts.stateTone ?? "violet"),
    note("note:trie", 24, 100, "edges are characters"),
    ...live.map((slot) => ({
      id: `n:${slot.id}`,
      shape: (slot.id === "root" ? "chip" : "cell") as "chip" | "cell",
      x: slot.x,
      y: slot.y,
      width: NODE_W,
      height: NODE_H,
      title: slot.label,
      detail: slot.word && present.includes(slot.id) ? "word" : undefined,
      tone: (created.includes(slot.id)
        ? "green"
        : slot.id === flagged
          ? "amber"
          : path.includes(slot.id)
            ? "blue"
            : "neutral") as VizTone,
      state: (created.includes(slot.id) || path.includes(slot.id) || slot.id === flagged ? "active" : undefined) as
        | "active"
        | undefined,
    })),
  ];

  const edges: VizEdge[] = live
    .filter((slot) => slot.parent && present.includes(slot.parent))
    .map((slot) => ({
      id: `e:${slot.id}`,
      source: `n:${slot.parent}`,
      target: `n:${slot.id}`,
      label: slot.label,
      state: (path.includes(slot.id) || created.includes(slot.id) ? "active" : undefined) as "active" | undefined,
    }));

  return { nodes, edges };
}

const CAT = ["root", "c", "ca", "cat"];
const CAT_CAR = [...CAT, "car"];
const ALL = [...CAT_CAR, "d", "do", "dog"];

const frames: VizFrame[] = [
  {
    label: "Empty",
    caption:
      "A trie starts as a single root holding nothing. Words are not stored in nodes — they are spelled out by the path taken from the root, one character per edge.",
    codeLines: [1, 3, 4],
    stats: [{ label: "words", value: "0" }],
    ...scene({ present: ["root"], stateText: "root, no children" }),
  },
  {
    label: 'Insert "cat"',
    caption:
      "Walk the word character by character, creating a child wherever one is missing. Three characters, three new nodes — and the last one gets a flag saying a word ends here.",
    codeLines: [6, 7, 8, 9, 10],
    stats: [{ label: "words", value: "1" }, { label: "nodes", value: "4" }],
    ...scene({ present: CAT, created: ["c", "ca", "cat"], flagged: "cat", stateText: 'insert "cat" → 3 nodes created' }),
  },
  {
    label: 'Insert "car"',
    caption:
      'The "ca" path already exists, so the walk reuses it and only the final "r" is new. Shared prefixes are stored exactly once — the property the whole structure is built around.',
    codeLines: [8, 9],
    stats: [{ label: "words", value: "2" }, { label: "nodes", value: "5" }],
    ...scene({
      present: CAT_CAR,
      path: ["c", "ca"],
      created: ["car"],
      stateText: '"ca" reused, only "r" allocated',
      stateTone: "green",
    }),
  },
  {
    label: 'Insert "dog"',
    caption: 'Nothing is shared with "dog", so it becomes a separate branch off the root. A trie is as wide as its alphabet and as deep as its longest word.',
    codeLines: [6, 8, 9, 10],
    stats: [{ label: "words", value: "3" }, { label: "nodes", value: "8" }],
    ...scene({ present: ALL, created: ["d", "do", "dog"], flagged: "dog", stateText: 'insert "dog" → new branch' }),
  },
  {
    label: 'Search "car"',
    caption:
      "Searching is the same walk without the creating: follow c, a, r. Three steps — the cost depends on the length of the word, not on how many words the trie holds.",
    codeLines: [12, 13, 14, 17],
    stats: [{ label: "steps", value: "3" }],
    ...scene({ present: ALL, path: ["c", "ca", "car"], stateText: 'walk c → a → r', stateTone: "blue" }),
  },
  {
    label: "The flag matters",
    caption:
      'The walk found a node, but that is not enough: "car" is a word only because the node carries the end flag. Without it, every prefix of every word would count as a word.',
    codeLines: [20, 22],
    stats: [{ label: "is word", value: "true" }],
    ...scene({ present: ALL, path: ["c", "ca"], flagged: "car", stateText: 'node exists AND is_word → "car" found', stateTone: "green" }),
  },
  {
    label: 'Search "ca"',
    caption:
      'The same walk for "ca" ends on a node with no flag. So search returns false while startsWith returns true — two different questions, one traversal, distinguished only by that boolean.',
    codeLines: [22, 25],
    stats: [{ label: "is word", value: "false" }],
    ...scene({ present: ALL, path: ["c", "ca"], stateText: 'prefix yes, word no', stateTone: "amber" }),
  },
  {
    label: "Prefix query",
    caption:
      'Autocomplete is the payoff: walk to the prefix node, then collect every word in the subtree below it. "ca" yields cat and car without touching the "d" branch at all.',
    codeLines: [18, 25],
    stats: [{ label: "matches", value: "2" }],
    ...scene({
      present: ALL,
      path: ["c", "ca"],
      created: ["cat", "car"],
      stateText: '"ca" → ["cat", "car"]',
      stateTone: "green",
    }),
  },
  {
    label: "Why not a hash map",
    caption:
      "A hash set answers \"is this exact word present\" just as fast. What it cannot do is answer \"which words start with ca\" without scanning every key — hashing destroys the ordering that prefixes rely on.",
    codeLines: [14, 17],
    stats: [{ label: "prefix query", value: "O(p + matches)" }],
    ...scene({ present: ALL, path: ["c", "ca"], stateText: "hash map: O(n) scan · trie: O(p) walk", stateTone: "teal" }),
  },
  {
    label: "The cost",
    caption:
      "Insert, search and prefix checks are all O(L) in the length of the word, independent of how many words are stored. Space is the total number of distinct prefixes — which is why a trie pays off on dictionaries with heavy overlap and wastes memory on random strings.",
    codeLines: [8, 14],
    stats: [
      { label: "time", value: "O(L)" },
      { label: "space", value: "O(total chars)" },
    ],
    ...scene({ present: ALL, stateText: "O(L) per operation, shared prefixes stored once", stateTone: "teal" }),
  },
];

export const trieViz: Viz = {
  width: 564,
  height: 300,
  legend: [
    { tone: "blue", label: "walked" },
    { tone: "green", label: "created / matched" },
    { tone: "amber", label: "end-of-word flag" },
  ],
  code: {
    language: "python",
    source: `class Node:
    def __init__(self):
        self.kids = {}
        self.is_word = False

def insert(root, word):
    node = root
    for ch in word:
        node = node.kids.setdefault(ch, Node())
    node.is_word = True

def find(root, word):
    node = root
    for ch in word:
        if ch not in node.kids:
            return None
        node = node.kids[ch]
    return node

def search(root, word):
    node = find(root, word)
    return node is not None and node.is_word

def starts_with(root, prefix):
    return find(root, prefix) is not None`,
  },
  frames,
};
