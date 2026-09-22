---
title: Dynamic Programming
order: 12
summary: "Recursion that refuses to solve the same sub-problem twice. Exponential becomes polynomial the moment the repeated work is written down and reused."
hardPart: "Finding the state. Once you can say what dp[i] means in one sentence, the recurrence and the code usually follow in a minute."
viz: dynamic-programming
tags: [recursion, memoisation, optimisation, tabulation]
complexity:
  - op: 1-D table (house robber, climbing stairs)
    time: O(n)
    space: O(n)
    note: "One cell per sub-problem, O(1) work each. Space collapses to O(1) whenever a cell reads only a fixed number of earlier cells."
  - op: 2-D table (edit distance, LCS, knapsack)
    time: O(n·m)
    space: O(n·m)
    note: "Usually reducible to O(min(n, m)) space by keeping only the previous row — a standard follow-up once the table version works."
  - op: Memoised recursion
    time: same as the table
    space: O(states + depth)
    note: "Identical asymptotics, plus stack frames. Easier to derive from the brute force, and it only computes the states actually reachable."
  - op: Without memoisation
    time: exponential
    note: "The same sub-problems recomputed down every branch. This is what the table replaces, and it is worth writing first to find the recurrence."
reachFor:
  - "\"How many ways\", \"minimum cost\", \"maximum value\", \"is it possible\" — counting and optimising rather than listing."
  - "A brute-force recursion whose call tree visits the same arguments repeatedly."
  - Sequence comparison — edit distance, longest common subsequence, sequence alignment.
  - "Choices over a resource — knapsack, coin change, partitioning under a budget."
  - Grid paths with costs or obstacles, where each cell's answer builds on its neighbours.
pitfalls:
  - "Starting from the table. Write the brute-force recursion first, then cache it — deriving the recurrence directly is where most people stall."
  - "A state that does not capture everything. If two different situations map to the same key but need different answers, the cache returns nonsense; the fix is adding a dimension, not special cases."
  - "Wrong iteration order in the bottom-up version. Every cell must be filled after the cells it reads, and getting that backwards silently reads zeros."
  - "Sloppy base cases. Most off-by-one bugs in DP are at index 0 or 1, and the table looks plausible everywhere else."
  - "Reaching for DP when the sub-problems do not overlap. Divide and conquer without repetition is just recursion, and memoising it adds cost for nothing."
followUps:
  - question: Memoisation or tabulation?
    answer: "Same complexity, different ergonomics. Memoisation is the brute force plus a cache, so it is faster to derive and only evaluates reachable states — good when the state space is sparse. Tabulation has no recursion overhead and no stack limit, and it makes space optimisation obvious because you can see which rows are still needed. Start top-down to find the recurrence, convert to bottom-up if depth or constants matter."
  - question: How do you reduce the space?
    answer: "Look at which cells the recurrence actually reads. If dp[i] depends only on dp[i−1] and dp[i−2], two variables suffice and the table is unnecessary. For 2-D tables that read only the previous row, keep one row and overwrite it — sometimes iterating backwards so the values you still need are not clobbered. This is the most common DP follow-up, and it is mechanical once the dependencies are written down."
  - question: How do you recover the actual answer, not just its value?
    answer: "Either store a parent pointer per cell recording which choice won, then walk it back from the final cell, or re-derive the path by replaying the recurrence over the completed table and checking which option produced each value. The second needs no extra memory but requires the full table, so it is incompatible with the rolling-array space optimisation — worth flagging when the interviewer asks for both."
  - question: How do you know a problem is DP and not greedy?
    answer: "Greedy works when a locally best choice is provably globally optimal — an exchange argument shows swapping in the greedy choice never hurts. DP is needed when a choice that looks worse now can pay off later, which is exactly the case coin change with denominations like 1, 3, 4 demonstrates: greedy takes 4+1+1 for six, while the optimum is 3+3. If you cannot prove the greedy choice is safe, assume DP."
---

# Dynamic Programming

## The mechanism is caching

DP is not a special algorithm — it is recursion where the same arguments keep coming back, plus somewhere to write down the answers. Every DP solution is the brute force with the repeated work deleted.

```python
def rob(houses, i=0):                    # exponential
    if i >= len(houses):
        return 0
    return max(rob(houses, i + 1), houses[i] + rob(houses, i + 2))
```

That call tree has 2ⁿ nodes but only n *distinct* arguments. Cache them and it is linear:

```python
from functools import cache

@cache                                    # that is the entire difference
def rob(i):
    if i >= len(houses):
        return 0
    return max(rob(i + 1), houses[i] + rob(i + 2))
```

## Finding the state

This is the hard part, and it is a sentence, not code: *dp[i] is the best total achievable using the first i houses*. Once that sentence exists, the recurrence is usually forced — at each step, enumerate the choices and take the best:

```
dp[i] = max(dp[i-1],              skip house i
            dp[i-2] + houses[i])  rob house i
```

If you cannot write the sentence, you do not have the state yet. The common failure is a state that is missing a dimension: two situations that share a key but need different answers. When that happens, add what distinguishes them — an index, a remaining budget, a flag for "did I already use the transaction".

## Two ways to write it

**Top-down** — the recursion, plus a cache. Derive it first; it is closest to the brute force.

```python
@cache
def best(i, budget):
    ...
```

**Bottom-up** — fill a table in an order that guarantees dependencies are ready.

```python
def rob(houses):
    dp = [0] * len(houses)
    dp[0] = houses[0]
    for i in range(1, len(houses)):
        take = houses[i] + (dp[i - 2] if i > 1 else 0)
        dp[i] = max(dp[i - 1], take)
    return dp[-1]
```

Same complexity. Bottom-up avoids recursion depth limits and makes the space optimisation visible — which matters, because it is the standard follow-up:

```python
def rob(houses):
    prev2 = prev = 0
    for value in houses:
        prev2, prev = prev, max(prev, prev2 + value)   # two cells is all it reads
    return prev
```

## The two-dimensional shape

Sequence problems put one input on each axis, and the recurrence compares the current pair:

```python
def edit_distance(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        dp[i][0] = i                       # delete everything
    for j in range(len(b) + 1):
        dp[0][j] = j                       # insert everything
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]            # free match
            else:
                dp[i][j] = 1 + min(dp[i - 1][j],       # delete
                                   dp[i][j - 1],       # insert
                                   dp[i - 1][j - 1])   # replace
    return dp[-1][-1]
```

The base row and column are the empty-string cases, and they are where the bugs are. Each cell reads only the row above and the cell to its left, so one row of memory is enough if space is asked about.

## A checklist

1. Write the brute-force recursion.
2. Name the state in one sentence, and check nothing is missing from it.
3. Write the recurrence as a choice between options.
4. Fix the base cases, then test n = 0 and n = 1.
5. Decide memoised or tabulated.
6. Collapse the space if the recurrence only looks back a fixed distance.

## What to say in the interview

Say the state sentence out loud before writing code — "dp[i][j] is the minimum edits to turn the first i characters of a into the first j of b" — then the recurrence, then the base cases. Give the cost as states × work-per-state, and offer the space reduction before being asked. If the brute force is where you start, say so: "let me write the recursion first, then add the cache" is the normal way to get there.
