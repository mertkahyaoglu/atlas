---
title: Stacks
order: 5
summary: "Last in, first out — and the structure behind matching, undo, recursion, and the monotonic trick that answers \"next greater\" for every element in one pass."
hardPart: "Naming what the stack holds. \"Indices still waiting for an answer\" is a real invariant; \"the stack\" is not."
viz: monotonic-stack
tags: [stack, monotonic, amortized, recursion]
complexity:
  - op: Push / pop / peek
    time: O(1)
    space: O(n)
    note: An array with an index, or a linked list. Nothing is searched, so the operations are unconditionally constant.
  - op: Monotonic stack scan
    time: O(n)
    space: O(n)
    note: A while loop inside a for loop, but each index is pushed once and popped once — at most 2n stack operations in total.
  - op: Bracket / expression matching
    time: O(n)
    space: O(n)
    note: One push per opener, one pop per closer. Space is the nesting depth, which is n in the worst case.
  - op: Recursion converted to a stack
    time: same
    space: O(depth)
    note: Turning recursion into an explicit stack does not change the cost, it moves the frames off the call stack and removes the overflow risk.
reachFor:
  - Matching or nesting — brackets, tags, expression parsing, directory paths.
  - "\"Next greater\" or \"previous smaller\" for every element, in any disguise: daily temperatures, stock spans, largest rectangle in a histogram."
  - Undo and history, or any "most recent thing first" behaviour.
  - Converting a recursive traversal into an iterative one, when depth could blow the call stack.
  - Evaluating or converting expressions — postfix evaluation is a stack and nothing else.
pitfalls:
  - Storing values instead of indices in a monotonic stack. The moment the answer needs a position or a width — histogram rectangles, span lengths — values alone are not enough, and it is cheap to store indices from the start.
  - Popping without checking the stack is empty. Every pop needs a guard, and a closing bracket with nothing to match is the test case that catches it.
  - "Forgetting what is left over. Items still on the stack at the end are not an error — they are the elements whose answer is \"none\", and they usually need an explicit default."
  - Using the wrong comparison and silently changing the meaning. `<` versus `<=` in the pop condition decides whether equal values resolve each other, which flips results for problems involving duplicates.
  - Claiming O(n²) for the monotonic scan because it has nested loops. The inner loop is bounded across the whole run, not per iteration — say the amortized argument out loud.
followUps:
  - question: Why is a nested loop still O(n) here?
    answer: Count the stack operations rather than the loop iterations. Each index is pushed exactly once, and once popped it never returns, so the total number of pops across the whole run is at most n. The inner while loop therefore does at most n work in total, not n work per outer step. The sum is at most 2n operations — linear.
  - question: How does the histogram rectangle problem use this?
    answer: For each bar you need the first smaller bar to its left and to its right; the span between them is the widest rectangle of that bar's height. A single increasing stack of indices gives both — when a bar pops, the popping bar is its right boundary and the new stack top is its left. Storing indices rather than heights is what makes the width computable.
  - question: When would you convert recursion into an explicit stack?
    answer: When depth is data-dependent and large — a tree that degenerates into a list, a graph traversal over a million nodes, or any language without tail calls and with a small default stack. The complexity is identical; you are trading implicit frames for a heap-allocated structure you control. It also makes the traversal pausable, which matters for iterators and generators.
  - question: Stack or queue — how do you tell which a problem wants?
    answer: Ask whether the most recent item or the oldest item should be handled first. Nesting, backtracking and undo are inherently most-recent-first, so they are stacks; level order, shortest unweighted path and fair scheduling are oldest-first, so they are queues. In graph terms it is exactly the difference between DFS and BFS, and swapping the container swaps the traversal.
---

# Stacks

## The plain version

Push, pop, peek, all O(1); the only access is the top. That restriction is the feature — it makes "the most recent unfinished thing" instantly available, which is what nesting problems need.

```python
def is_balanced(s):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif not stack or stack.pop() != pairs[ch]:
            return False
    return not stack               # leftovers mean unclosed openers
```

Two things in that function generalise to every stack problem: the guard before popping, and the check on what is left at the end.

## The monotonic stack

Keep the stack sorted — increasing or decreasing — by popping anything that would break the order as each new element arrives. Each pop is then an answered question, which is the visualisation above.

```python
def next_greater(nums):
    out = [-1] * len(nums)
    stack = []                                  # indices, values decreasing
    for i, value in enumerate(nums):
        while stack and nums[stack[-1]] < value:
            out[stack.pop()] = value            # this element is the answer
        stack.append(i)
    return out
```

The invariant is the part to say aloud: *the stack holds the indices that have not yet found their next greater element, and their values decrease from bottom to top*. Everything else follows. The new element resolves every waiting index smaller than it, then waits its own turn. Stopping at the first larger value is safe because everything below it is larger still.

Four decisions define a variant:

| Decision | Effect |
| --- | --- |
| Increasing or decreasing stack | Next greater versus next smaller |
| Scan left to right or right to left | Next versus previous |
| `<` or `<=` in the pop test | Whether equal values resolve each other |
| Store indices or values | Whether widths and distances are computable |

Get those four right and the code is four lines.

## Where the stack is hiding

Recursion *is* a stack — the call stack. Any recursive traversal can be rewritten with an explicit one, which is how iterative DFS works:

```python
def dfs(root):
    stack = [root]
    while stack:
        node = stack.pop()
        visit(node)
        stack.extend(reversed(node.children))   # reversed to keep left-to-right order
    return
```

Swap that stack for a queue and the same six lines become breadth-first search. The container chooses the traversal order — which is the cleanest way to remember the difference.

## What to say in the interview

Say what the stack holds before writing the loop, and if it is monotonic say why the ordering is maintained. Then give the cost with its justification: O(n) time because each element is pushed once and popped at most once, O(n) space for the stack. Nested loops with an amortized bound are a standard place to lose points by guessing O(n²).
