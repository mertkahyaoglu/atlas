---
title: Trees and Traversals
order: 7
summary: "Recursive structure, recursive solutions. Most tree questions are one traversal with the work moved to the right point in the recursion — and the cost is decided by the height, not the count."
hardPart: "Choosing the traversal from what the problem needs, and knowing which answers can only be computed on the way back up."
viz: binary-tree
tags: [tree, recursion, bst, dfs, bfs]
complexity:
  - op: Any traversal (DFS or BFS)
    time: O(n)
    space: O(h)
    note: "Every node is entered once. DFS space is the height h; BFS space is the widest level, which is n/2 for a full tree."
  - op: BST search / insert / delete
    time: O(h)
    note: "O(log n) when balanced, O(n) when the tree degenerates into a list. Unbalanced insertion of sorted data is exactly how that happens."
  - op: Balanced BST (AVL, red-black)
    time: O(log n)
    space: O(n)
    note: "Rotations keep h at O(log n) so the worst case matches the average. This is what a std::map or TreeMap gives you."
  - op: Height / diameter / subtree sums
    time: O(n)
    space: O(h)
    note: "Computed bottom-up: each node returns a summary to its parent, so one postorder pass answers what looks like a per-node question."
reachFor:
  - Hierarchical data — file systems, org charts, the DOM, expression trees, decision trees.
  - "Sorted data with frequent insertions, where an array would have to shift: a balanced BST keeps order at O(log n)."
  - "Range queries and \"nearest value\" lookups, which a hash map cannot answer at all."
  - "Anything phrased per level, or asking for the shortest path in an unweighted structure — that is BFS."
  - Problems where a subtree's answer composes into its parent's, which is the signature of a bottom-up recursion.
pitfalls:
  - "Missing the null base case. Every recursive tree function starts with the empty check; without it the first leaf's child crashes the call."
  - "Assuming a BST is balanced. Inserting sorted values builds a linked list with extra steps, turning every O(log n) claim into O(n)."
  - "Validating a BST by comparing only against the parent. The property is about ranges — each node must fall inside a (low, high) window carried down from its ancestors."
  - "Recursing on a deep tree without thinking about the stack. A skewed tree of 10⁵ nodes overflows the default limits in most languages."
  - "Using DFS for shortest path. Depth-first finds a path; only breadth-first finds the shortest one in an unweighted graph or tree."
followUps:
  - question: Which traversal for which problem?
    answer: "Preorder when the parent's information is needed before the children — serialising, copying, prefix paths. Inorder for BSTs, because it yields sorted order. Postorder when a node needs its children's results — heights, diameters, subtree sums, deletion. Level order for anything per-level or for the shortest number of steps. The choice is decided by where the work must happen relative to the recursive calls."
  - question: How do you validate a binary search tree?
    answer: "Carry a permitted range down the recursion: the root may be anything, a left child must be below its parent, a right child above, and each subtree tightens the interval. Comparing a node only with its immediate parent passes trees that are obviously invalid — a value in the right subtree that is smaller than the root three levels up. The alternative is an inorder walk checking that the sequence is strictly increasing."
  - question: Compute the diameter of a binary tree.
    answer: "Do one postorder pass where each call returns its height, and while returning, update a running best with left height + right height + 2 — the longest path through that node. The answer is a global maximum over local computations, which is the general shape for tree problems that ask about paths rather than nodes. It is O(n) with a single traversal, not O(n²) with a height call per node."
  - question: When would you not use recursion?
    answer: "When the height is data-dependent and could be large — a skewed tree, or a traversal over millions of nodes — because the call stack will overflow before the algorithm has a chance to be slow. Convert it to an explicit stack, which is the same complexity with memory you control. Morris traversal goes further and gets O(1) space by temporarily rewiring the tree, which is worth naming as an aside but rarely worth writing under time pressure."
---

# Trees and Traversals

## The structure decides the code

A tree is defined recursively, so the code is too: handle the empty case, do something with the node, recurse into the children. Almost every question is that skeleton with the work moved around.

```python
def walk(node):
    if not node:              # 1. base case, always first
        return
    # preorder work here
    walk(node.left)
    # inorder work here
    walk(node.right)
    # postorder work here
```

Where the work goes is the entire decision:

| Work happens | Order | Good for |
| --- | --- | --- |
| Before the calls | Preorder | Serialising, copying, passing context down |
| Between the calls | Inorder | BST → sorted sequence |
| After the calls | Postorder | Heights, diameters, subtree sums, deletion |
| In a queue loop | Level order | Per-level answers, shortest path |

## Top-down and bottom-up

Two ways to carry information, and picking the wrong one is what makes a tree problem feel hard.

**Top-down**: pass context into the recursion. Depth, accumulated path, permitted value range.

```python
def is_bst(node, low=float("-inf"), high=float("inf")):
    if not node:
        return True
    if not low < node.value < high:
        return False
    return (is_bst(node.left, low, node.value)
            and is_bst(node.right, node.value, high))
```

**Bottom-up**: return a summary from the recursion and combine it at the parent.

```python
def diameter(root):
    best = 0
    def height(node):
        nonlocal best
        if not node:
            return -1
        left, right = height(node.left), height(node.right)
        best = max(best, left + right + 2)   # path through this node
        return 1 + max(left, right)
    height(root)
    return best
```

The tell for bottom-up: the question is about a node's subtrees, and the answer is a maximum or a sum over all nodes. One pass, O(n) — computing height separately per node would be O(n²).

## Breadth-first

Swap the stack for a queue and you walk level by level. Tracking the level boundary is the part worth memorising:

```python
def levels(root):
    if not root:
        return []
    out, queue = [], deque([root])
    while queue:
        level = []
        for _ in range(len(queue)):        # snapshot this level's size
            node = queue.popleft()
            level.append(node.value)
            queue.extend(c for c in (node.left, node.right) if c)
        out.append(level)
    return out
```

That `len(queue)` snapshot is what separates the levels; without it every node blends into one list. BFS is also the only correct choice for "fewest steps" questions — depth-first finds *a* path, not the shortest.

## Binary search trees

A BST adds an ordering invariant: everything left is smaller, everything right is larger. That turns search into [binary search](/coding/04-binary-search) over a structure that also supports O(log n) insertion — provided it stays balanced. It does not stay balanced on its own, and inserting sorted data produces a linked list, which is why real libraries use red-black or AVL trees.

What a BST gives you over a [hash map](/coding/01-hash-tables): ordered iteration, range queries, and "nearest value above x". What it costs: O(log n) instead of O(1) per lookup.

## What to say in the interview

Say which traversal you are using and why before writing it, and if the answer composes from subtrees, say "this is bottom-up — each call returns a summary". Give the cost as O(n) time and O(h) space, then immediately say what h is: log n balanced, n skewed. That last clause is the one interviewers wait for.
