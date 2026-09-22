import { note, opBox } from "./layout";
import type { Viz, VizEdge, VizFrame, VizNode, VizTone } from "./types";

/**
 * Breadth-first search over an unweighted graph: the queue, the visited set,
 * and why the first time a node is reached is always by a shortest path.
 */

const POS: Record<string, { x: number; y: number }> = {
  A: { x: 24, y: 150 },
  B: { x: 184, y: 80 },
  C: { x: 184, y: 220 },
  D: { x: 344, y: 80 },
  E: { x: 344, y: 220 },
  F: { x: 504, y: 150 },
};

const EDGES: [string, string][] = [
  ["A", "B"],
  ["A", "C"],
  ["B", "D"],
  ["C", "D"],
  ["C", "E"],
  ["D", "F"],
  ["E", "F"],
];

const NODE_W = 96;
const NODE_H = 36;
const QUEUE_Y = 286;

interface SceneOpts {
  /** Node being expanded right now. */
  current?: string;
  /** Front-to-back contents of the queue. */
  queue: string[];
  /** Distance from the source, for every node discovered so far. */
  dist: Record<string, number>;
  /** Nodes fully expanded. */
  done?: string[];
  /** An edge that led to an already-visited node — the one BFS ignores. */
  skipped?: [string, string];
  stateText: string;
  stateTone?: VizTone;
}

function scene(opts: SceneOpts): { nodes: VizNode[]; edges: VizEdge[] } {
  const { current, queue, dist, done = [], skipped } = opts;

  const nodes: VizNode[] = [
    opBox("state", 24, 12, 380, "bfs", opts.stateText, opts.stateTone ?? "violet"),
    note("note:queue", 24, QUEUE_Y - 22, "queue — front on the left"),
    ...Object.entries(POS).map(([id, at]) => ({
      id: `n:${id}`,
      shape: "box" as const,
      x: at.x,
      y: at.y,
      width: NODE_W,
      height: NODE_H,
      title: id,
      detail: id in dist ? `d=${dist[id]}` : undefined,
      tone: (id === current ? "blue" : done.includes(id) ? "green" : queue.includes(id) ? "amber" : "neutral") as VizTone,
      state: (id === current || queue.includes(id)
        ? "active"
        : id in dist
          ? undefined
          : "dimmed") as "active" | "dimmed" | undefined,
    })),
    ...queue.map((id, i) => ({
      id: `q:${id}`,
      shape: "chip" as const,
      x: 24 + i * 92,
      y: QUEUE_Y,
      width: 80,
      height: 30,
      title: id,
      tone: "amber" as const,
      state: "active" as const,
    })),
  ];

  const edges: VizEdge[] = EDGES.map(([a, b]) => {
    const isSkipped = skipped && ((skipped[0] === a && skipped[1] === b) || (skipped[0] === b && skipped[1] === a));
    const isTree = dist[b] === (dist[a] ?? -9) + 1 && (done.includes(a) || a === current);
    return {
      id: `e:${a}${b}`,
      source: `n:${a}`,
      target: `n:${b}`,
      state: (isSkipped ? "dimmed" : isTree ? "active" : undefined) as "active" | "dimmed" | undefined,
    };
  });

  return { nodes, edges };
}

const stats = (seen: number, queued: number) => [
  { label: "discovered", value: `${seen} / 6` },
  { label: "in queue", value: String(queued) },
];

const frames: VizFrame[] = [
  {
    label: "The graph",
    caption:
      "Six nodes, seven undirected edges, no weights. Stored as an adjacency list — a map from each node to its neighbours — which is what makes visiting every edge cheap.",
    codeLines: [1],
    stats: stats(0, 0),
    ...scene({ queue: [], dist: {}, stateText: "unweighted, adjacency list" }),
  },
  {
    label: "Start at A",
    caption:
      "A goes into the queue at distance 0 and is marked visited immediately. Marking on enqueue rather than on dequeue is what stops the same node being queued twice.",
    codeLines: [2, 3],
    stats: stats(1, 1),
    ...scene({ queue: ["A"], dist: { A: 0 }, stateText: "queue = [A], visited = {A}" }),
  },
  {
    label: "Expand A",
    caption:
      "Take A off the front and look at its neighbours. B and C are new, so both are recorded at distance 1 and queued behind whatever is already waiting.",
    codeLines: [4, 5, 6, 7, 8],
    stats: stats(3, 2),
    ...scene({
      current: "A",
      queue: ["B", "C"],
      dist: { A: 0, B: 1, C: 1 },
      done: [],
      stateText: "A → B, C at distance 1",
      stateTone: "green",
    }),
  },
  {
    label: "Expand B",
    caption: "B's only unseen neighbour is D, discovered at distance 2. The queue is still in distance order — that ordering is the whole guarantee.",
    codeLines: [4, 5, 6, 7, 8],
    stats: stats(4, 2),
    ...scene({
      current: "B",
      queue: ["C", "D"],
      dist: { A: 0, B: 1, C: 1, D: 2 },
      done: ["A"],
      stateText: "B → D at distance 2",
      stateTone: "green",
    }),
  },
  {
    label: "Skip a seen node",
    caption:
      "C also touches D, but D already has a distance, so the edge is ignored. Without that check the node would be queued twice and the search could loop forever on a cyclic graph.",
    codeLines: [6, 7],
    stats: stats(5, 2),
    ...scene({
      current: "C",
      queue: ["D", "E"],
      dist: { A: 0, B: 1, C: 1, D: 2, E: 2 },
      done: ["A", "B"],
      skipped: ["C", "D"],
      stateText: "D already seen → skip; E discovered",
      stateTone: "amber",
    }),
  },
  {
    label: "Reach F",
    caption: "D expands to F at distance 3 — the first time F is seen, and therefore along a shortest route to it.",
    codeLines: [7, 8],
    stats: stats(6, 2),
    ...scene({
      current: "D",
      queue: ["E", "F"],
      dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
      done: ["A", "B", "C"],
      stateText: "F discovered at distance 3",
      stateTone: "green",
    }),
  },
  {
    label: "E adds nothing",
    caption:
      "E also touches F, but F is already recorded, so nothing changes. Every edge is examined exactly once from each end, and most of them resolve to nothing — which is fine, because each check is O(1).",
    codeLines: [6],
    stats: stats(6, 1),
    ...scene({
      current: "E",
      queue: ["F"],
      dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
      done: ["A", "B", "C", "D"],
      skipped: ["E", "F"],
      stateText: "F already seen → skip",
      stateTone: "amber",
    }),
  },
  {
    label: "Done",
    caption:
      "The queue empties and every reachable node carries its distance from A. Those numbers are shortest path lengths in edges, and reconstructing the path means storing a parent alongside each distance.",
    codeLines: [9],
    stats: stats(6, 0),
    ...scene({
      queue: [],
      dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
      done: ["A", "B", "C", "D", "E", "F"],
      stateText: "distances: A0 B1 C1 D2 E2 F3",
      stateTone: "green",
    }),
  },
  {
    label: "Why shortest",
    caption:
      "Nodes leave the queue in non-decreasing distance order, so everything at distance k is expanded before anything at k+1. The first time a node is discovered is therefore via the fewest possible edges — which is exactly why this fails once edges have weights.",
    codeLines: [4, 8],
    stats: [{ label: "guarantee", value: "unweighted only" }],
    ...scene({
      queue: [],
      dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
      done: ["A", "B", "C", "D", "E", "F"],
      stateText: "layer by layer → first visit is shortest",
      stateTone: "teal",
    }),
  },
  {
    label: "Swap for a stack",
    caption:
      "Change the queue to a stack and the identical code becomes depth-first search: it dives to F through one branch before touching the other. DFS finds a path, not the shortest one — the container decides which.",
    codeLines: [4],
    stats: [{ label: "dfs finds", value: "a path" }],
    ...scene({
      current: "F",
      queue: [],
      dist: { A: 0, B: 1, D: 2, F: 3 },
      done: ["A", "B", "D"],
      stateText: "queue → stack = DFS",
      stateTone: "teal",
    }),
  },
  {
    label: "The cost",
    caption:
      "Each node is queued once and each edge inspected twice in an undirected graph: O(V + E) time, O(V) space. With an adjacency matrix it degrades to O(V²), because finding the neighbours of a node means scanning an entire row.",
    codeLines: [5],
    stats: [
      { label: "time", value: "O(V + E)" },
      { label: "space", value: "O(V)" },
    ],
    ...scene({
      queue: [],
      dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
      done: ["A", "B", "C", "D", "E", "F"],
      stateText: "list O(V+E)  ·  matrix O(V²)",
      stateTone: "teal",
    }),
  },
];

export const graphBfsViz: Viz = {
  width: 624,
  height: 340,
  legend: [
    { tone: "blue", label: "expanding" },
    { tone: "amber", label: "queued" },
    { tone: "green", label: "done" },
  ],
  code: {
    language: "python",
    source: `def bfs(graph, source):
    dist = {source: 0}
    queue = deque([source])
    while queue:
        node = queue.popleft()
        for nxt in graph[node]:
            if nxt not in dist:
                dist[nxt] = dist[node] + 1
                queue.append(nxt)
    return dist`,
  },
  frames,
};
