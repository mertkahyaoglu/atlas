---
title: Backtracking
order: 11
summary: "Depth-first search over decisions, with the decision undone on the way back out. The answer to every \"generate all…\" and \"find an arrangement that works\" question."
hardPart: "Pruning. The template is three lines; whether the search finishes this century depends on how early invalid branches are cut."
viz: backtracking
tags: [recursion, dfs, combinatorics, pruning]
complexity:
  - op: All subsets
    time: O(2ⁿ · n)
    space: O(n)
    note: "2ⁿ subsets, each costing O(n) to copy into the output. Space is the recursion depth, not the output."
  - op: All permutations
    time: O(n! · n)
    space: O(n)
    note: "n! arrangements, each O(n) to emit. Anything asking for every ordering is factorial, and that is expected."
  - op: Combinations of size k
    time: O(C(n,k) · k)
    note: "Fewer branches than subsets because the recursion only ever moves forward through the candidates, which also removes duplicates."
  - op: Constraint problems (N-Queens, sudoku)
    time: exponential, heavily pruned
    note: "The bound is meaningless in practice — what matters is how early the validity check rejects a partial arrangement."
reachFor:
  - "\"Generate all\" — subsets, permutations, combinations, partitions, valid parenthesisations."
  - Puzzles with constraints — N-Queens, sudoku, crosswords, word search on a grid.
  - Finding any arrangement that satisfies a rule, where a greedy choice might paint you into a corner.
  - Path enumeration through a graph or grid when every path is wanted, not just the shortest.
  - "Problems where the input is tiny (n ≤ 20 or so) — that bound in the problem statement is usually a hint that exponential is intended."
pitfalls:
  - "Forgetting to undo the choice. The path is shared across the whole recursion, so a missing pop leaks decisions into sibling branches and the output silently goes wrong."
  - "Appending the path instead of a copy. Every result then points at the same list, which ends up empty when the recursion unwinds."
  - "Skipping the pruning check. Exploring a branch that is already invalid is where the exponential actually bites; the check belongs at the top of the call, not at the leaf."
  - "Producing duplicates on inputs with repeats. Sort first and skip a candidate equal to the previous one at the same depth, or the same combination appears many times."
  - "Recursing over the whole candidate list for combinations. Passing a start index is what keeps [1,2] and [2,1] from both appearing."
followUps:
  - question: How do you avoid duplicate results when the input has repeats?
    answer: "Sort the input, then at each level skip any candidate equal to the one before it unless the previous copy was used in this branch. The rule is that duplicates may appear in a result, but the same shape must not be generated twice at the same depth. Without the sort the check is impossible, because equal values are not adjacent."
  - question: Backtracking or dynamic programming?
    answer: "Backtracking enumerates; DP counts or optimises. If the problem asks for every arrangement, the output is exponential and there is nothing to memoise. If it asks how many, or for the best one, sub-problems usually overlap and the answer is [dynamic programming](/coding/12-dynamic-programming). The giveaway is whether the question wants the objects themselves or a number about them."
  - question: What does pruning actually buy?
    answer: "It removes whole subtrees. In N-Queens, checking column and diagonal conflicts as each queen is placed cuts the search from 64-choose-8 arrangements to a few thousand explorations. The complexity class is unchanged, but the constant is what decides whether the program returns. Checking validity incrementally — a set of occupied columns and diagonals rather than a full board scan — is the other half."
  - question: How deep does the recursion go, and does it matter?
    answer: "Depth equals the number of decisions, which is n for subsets and permutations — so O(n) stack, not O(2ⁿ). That is worth saying because people often conflate the size of the output with the size of the memory. The output itself is exponential, but it is written out, not held on the stack."
---

# Backtracking

## Choose, explore, un-choose

Every backtracking solution is a depth-first walk over a tree of decisions, where the path from the root is the partial answer:

```python
def subsets(nums):
    out, path = [], []
    def walk(i):
        if i == len(nums):
            out.append(path[:])      # copy — path keeps mutating
            return
        path.append(nums[i])         # choose
        walk(i + 1)                  # explore
        path.pop()                   # un-choose
        walk(i + 1)                  # and try without it
    walk(0)
    return out
```

The `pop` is the backtrack. It exists because `path` is a single shared list — without it, decisions from one branch leak into its siblings. Copying the path at every node instead removes the need to undo, at the cost of an allocation per call; both are correct, and saying which you chose and why is worth a sentence.

## The general template

```python
def solve(state):
    if is_complete(state):
        record(state)
        return
    for choice in candidates(state):
        if not is_valid(state, choice):
            continue                 # prune — the whole subtree dies here
        apply(state, choice)
        solve(state)
        undo(state, choice)
```

Four decisions turn this into any specific problem:

| Piece | Subsets | Permutations | N-Queens |
| --- | --- | --- | --- |
| State | index + path | used set + path | row + occupied columns/diagonals |
| Candidates | take / skip | every unused value | every column in this row |
| Validity | always valid | not already used | no column or diagonal conflict |
| Complete | index == n | path length == n | row == n |

## Pruning is the algorithm

Subsets explore the entire tree because every leaf is an answer. Constraint problems are the opposite: most branches are dead, and the whole skill is killing them early.

```python
def n_queens(n):
    cols, diag, anti, out = set(), set(), set(), []
    def place(row, board):
        if row == n:
            out.append(board[:])
            return
        for col in range(n):
            if col in cols or row - col in diag or row + col in anti:
                continue                       # rejected before recursing
            cols.add(col); diag.add(row - col); anti.add(row + col)
            place(row + 1, board + [col])
            cols.remove(col); diag.remove(row - col); anti.remove(row + col)
    place(0, [])
    return out
```

Two things make that fast. The check happens *before* the recursive call, so an invalid placement costs nothing beyond the test. And validity is tracked incrementally in three sets, so each check is O(1) rather than a scan of the board.

## Combinations without duplicates

Passing a start index — rather than looping over all candidates every time — is what keeps `[1,2]` and `[2,1]` from both appearing:

```python
def combinations(nums, k):
    out, path = [], []
    def walk(start):
        if len(path) == k:
            out.append(path[:])
            return
        for i in range(start, len(nums)):
            path.append(nums[i])
            walk(i + 1)              # forward only
            path.pop()
    walk(0)
    return out
```

For inputs with repeated values, sort first and add `if i > start and nums[i] == nums[i-1]: continue`. That skips a duplicate candidate at the same depth while still allowing the value to appear deeper in the path.

## What to say in the interview

Name the three pieces before writing anything: what the state is, what the choices are, and when a partial answer is invalid. Then write the template and fill them in. For the cost, give the output size — 2ⁿ or n! — and separately note the stack depth is only O(n). If there is any validity constraint, say where the pruning check goes and why it is at the top of the loop rather than at the leaf.
