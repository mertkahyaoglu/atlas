import type { Viz } from "./types";
import { backtrackingViz } from "./backtracking";
import { binarySearchViz } from "./binary-search";
import { binaryTreeViz } from "./binary-tree";
import { dynamicProgrammingViz } from "./dynamic-programming";
import { graphBfsViz } from "./graph-bfs";
import { hashTableViz } from "./hash-table";
import { heapViz } from "./heap";
import { intervalsViz } from "./intervals";
import { linkedListViz } from "./linked-list";
import { monotonicStackViz } from "./monotonic-stack";
import { slidingWindowViz } from "./sliding-window";
import { trieViz } from "./trie";
import { twoPointersViz } from "./two-pointers";

/** `viz:` in a concept's frontmatter names one of these. */
export const vizzes: Record<string, Viz> = {
  "hash-table": hashTableViz,
  "two-pointers": twoPointersViz,
  "sliding-window": slidingWindowViz,
  "binary-search": binarySearchViz,
  "monotonic-stack": monotonicStackViz,
  "linked-list": linkedListViz,
  "binary-tree": binaryTreeViz,
  heap: heapViz,
  trie: trieViz,
  "graph-bfs": graphBfsViz,
  backtracking: backtrackingViz,
  "dynamic-programming": dynamicProgrammingViz,
  intervals: intervalsViz,
};
