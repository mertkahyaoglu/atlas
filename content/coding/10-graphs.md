---
title: Graphs
order: 10
summary: "Nodes and edges, and two traversals that answer most questions about them. The hard part is usually recognising that a problem is a graph at all."
hardPart: "Modelling — deciding what a node is and what an edge means — and then picking BFS, DFS or Dijkstra for the right reason."
viz: graph-bfs
tags: [graph, bfs, dfs, shortest-path, topological-sort]
complexity:
  - op: BFS / DFS (adjacency list)
    time: O(V + E)
    space: O(V)
    note: "Every node is visited once and every edge inspected once from each end. The visited set is what keeps it linear on cyclic graphs."
  - op: BFS / DFS (adjacency matrix)
    time: O(V²)
    note: "Finding a node's neighbours means scanning a whole row. Use a matrix only for dense graphs or O(1) edge lookups."
  - op: Dijkstra with a binary heap
    time: O((V + E) log V)
    space: O(V)
    note: "BFS with a priority queue, for non-negative weights. Negative edges break the argument and need Bellman-Ford at O(V·E)."
  - op: Topological sort
    time: O(V + E)
    note: "Kahn's algorithm, or DFS postorder reversed. Also the cycle test for a directed graph: fewer than V nodes emitted means a cycle."
reachFor:
  - "Anything with relationships — followers, dependencies, routes, prerequisites, state transitions."
  - "\"Fewest steps\" or \"shortest path\" in an unweighted setting, which is BFS exactly."
  - "Grids. A grid is a graph where each cell has up to four neighbours, and most maze, island and flood-fill problems are graph traversals in disguise."
  - Cycle detection, dependency ordering, build systems, course schedules.
  - Connected components — islands, friend circles, clustering by reachability.
pitfalls:
  - "Marking visited on dequeue instead of on enqueue. The same node then enters the queue several times before it is expanded, and the work explodes on dense graphs."
  - "Using DFS for a shortest path. Depth-first finds a path and will happily return a long one; only BFS gives the fewest edges."
  - "Running Dijkstra with negative weights. The settled-node argument fails, and the result is silently wrong rather than obviously broken."
  - "Forgetting that an undirected edge goes in both adjacency lists. Half a graph is a maddening bug to find later."
  - "Ignoring disconnected components. A single traversal from one source only reaches its component — counting islands means looping over every unvisited node."
followUps:
  - question: When is BFS the wrong choice for shortest path?
    answer: "As soon as edges have different weights. BFS assumes every edge costs one, so the first time it reaches a node is optimal; with weights, a longer route in edges may be cheaper in cost. Non-negative weights want Dijkstra, which is the same loop with a priority queue instead of a plain one. Negative weights break Dijkstra's assumption too and need Bellman-Ford, or Floyd–Warshall for all pairs."
  - question: How do you detect a cycle?
    answer: "In a directed graph, DFS with three colours — unvisited, in-progress, finished — and an edge back to an in-progress node is a cycle. Alternatively run Kahn's topological sort and check whether fewer than V nodes came out. In an undirected graph, a visited neighbour that is not the node you came from is a cycle, so the parent has to be passed down."
  - question: How would you model a grid problem as a graph?
    answer: "Each cell is a node; its neighbours are the adjacent cells that are in bounds and passable. Nothing else changes — BFS over that gives the shortest path through a maze, and DFS or BFS from every unvisited land cell counts islands. The cost is O(rows × cols), since each cell is a node and each has at most four edges. Saying this explicitly is usually what the interviewer is listening for."
  - question: Topological sort — how, and when does it not exist?
    answer: "Kahn's algorithm: compute every node's in-degree, queue the zeroes, and each time you emit a node decrement its neighbours, queueing any that reach zero. It exists only for a DAG — if a cycle is present, those nodes never reach in-degree zero and the output is short of V, which doubles as the cycle check. The DFS variant is a postorder traversal with the result reversed."
---

# Graphs

## Modelling comes first

Most graph questions do not say "graph". They say courses with prerequisites, words one edit apart, a grid of land and water, packages that depend on packages. The work is deciding what a node is and what an edge means; once that is settled, the algorithm is usually BFS or DFS off the shelf.

Two representations, and the choice is about density:

```python
graph = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"]}   # adjacency list — default
matrix = [[0, 1, 1], [0, 0, 1], [0, 0, 0]]                # adjacency matrix — dense, O(1) edge test
```

A list is O(V + E) space and makes traversal linear. A matrix is O(V²) space and only pays off when the graph is dense or you need to ask "is there an edge between these two" constantly.

## The two traversals are one algorithm

```python
def traverse(graph, source):
    seen = {source}
    frontier = deque([source])           # stack -> DFS, queue -> BFS
    while frontier:
        node = frontier.popleft()        # .pop() for DFS
        for nxt in graph[node]:
            if nxt not in seen:
                seen.add(nxt)            # mark on discovery, not on expansion
                frontier.append(nxt)
```

Swap the container and the order of exploration changes completely; everything else is identical. Two details in that loop carry all the weight:

- **`seen` is checked before queuing.** Without it, a cycle makes the loop run forever.
- **Nodes are marked when discovered, not when expanded.** Mark on expansion and a node can sit in the queue several times over.

## BFS and shortest paths

Because BFS drains the queue in distance order, nodes come out in layers: everything one edge away, then everything two edges away. The first time a node is discovered is therefore along a path with the fewest edges — the guarantee that makes BFS the answer to "minimum number of steps".

```python
def shortest_path(graph, source, target):
    parent = {source: None}
    queue = deque([source])
    while queue:
        node = queue.popleft()
        if node == target:
            break
        for nxt in graph[node]:
            if nxt not in parent:
                parent[nxt] = node        # remember how we got here
                queue.append(nxt)
    path, node = [], target               # walk the parents backwards
    while node is not None:
        path.append(node)
        node = parent.get(node)
    return path[::-1]
```

Storing a parent alongside each node is what turns "how far" into "which route". The moment edges carry different weights, this argument collapses and you need Dijkstra — the same loop with a [heap](/coding/08-heaps) as the frontier.

## DFS and structure

Depth-first is the tool for questions about structure rather than distance: cycles, components, ordering, articulation points. The recursive form is short enough to write under pressure, but remember the stack depth is the path length — an explicit stack is safer on large graphs.

Topological order, via Kahn's algorithm:

```python
def topo(graph, indegree):
    queue = deque(n for n in graph if indegree[n] == 0)
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for nxt in graph[node]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    return order if len(order) == len(graph) else []    # short = cycle
```

That last line is two answers in one: the ordering when it exists, and cycle detection when it does not.

## Which algorithm

| Question | Algorithm |
| --- | --- |
| Fewest edges to reach a node | BFS |
| Cheapest route, non-negative weights | Dijkstra |
| Cheapest route, negative weights allowed | Bellman-Ford |
| Is there a cycle / valid ordering | DFS colours, or Kahn |
| How many connected pieces | DFS or BFS from every unvisited node |
| Grid, maze, islands, flood fill | BFS or DFS over cells |

## What to say in the interview

State the model first — "nodes are cells, edges are the four neighbours" — then name the traversal and why. Give the cost as O(V + E) and say what V and E are *in this problem*, because for a grid that is rows × cols and four times that. If the question mentions weights, say why BFS is no longer sufficient before reaching for a heap.
