---
title: Sliding Window
order: 3
summary: "A contiguous span with two edges that only ever move forward. Turns \"check every subarray\" into one pass — as long as the window's validity is monotone."
hardPart: "Proving it is linear, and noticing when the window condition is not monotone enough for the technique to be valid at all."
viz: sliding-window
tags: [array, string, hash-map, amortized]
complexity:
  - op: Variable window (longest / shortest run)
    time: O(n)
    space: O(k)
    note: Each index enters the window once and leaves once, so the two edges make at most 2n moves. k is the number of distinct items tracked.
  - op: Fixed window of size k
    time: O(n)
    space: O(1)
    note: Add the entering element, subtract the leaving one. Recomputing the whole window each step is the common mistake and costs O(n·k).
  - op: Brute force over all subarrays
    time: O(n²)
    space: O(1)
    note: What the window replaces. Validating each subarray from scratch makes it O(n³); the window keeps the running state instead.
  - op: Exactly k distinct (via at-most)
    time: O(n)
    space: O(k)
    note: "\"Exactly k\" is not monotone, so it is solved as atMost(k) − atMost(k−1): two linear windows rather than one clever one."
reachFor:
  - "\"Longest\" or \"shortest\" contiguous run satisfying some property."
  - Fixed-size statistics — max sum or average of every k consecutive elements.
  - Counting subarrays whose contents satisfy a bound, often via the at-most trick.
  - Anagram and permutation matching inside a string, where the window is a character count.
  - Rate limiting, moving averages, and stream de-duplication — the same structure outside interviews.
pitfalls:
  - Using a window where validity is not monotone. "Sum ≥ k" with negative numbers breaks it — shrinking can make an invalid window valid again, so the edges have nothing to steer by. That case wants prefix sums, not a window.
  - Recomputing the window's contents on every step. That quietly restores the O(n·k) you were trying to remove; the window must be updated incrementally as elements enter and leave.
  - Shrinking with `if` when the fix needs a loop. One removal may not restore validity — `while` is the default, and `if` only when a single step provably suffices.
  - Moving the left edge backwards. The linear bound depends on it never rewinding; if your logic wants to, the window is the wrong tool.
  - "Off-by-one in the size. A window of `[left, right]` inclusive has `right - left + 1` elements, and best should be recorded when the window is valid, not after a shrink step that has not finished."
followUps:
  - question: Fixed-size and variable-size windows — what actually differs?
    answer: The loop shape. A fixed window moves both edges together, so each step is one add and one remove and the size never changes. A variable window grows on the right unconditionally and shrinks on the left only while the invariant is broken, so the size is whatever validity allows. Fixed windows need no invariant check at all, which is why they are O(1) space.
  - question: Why is it linear when there is a loop inside a loop?
    answer: Because the inner loop's total work is bounded across the whole run, not per iteration. The left edge only advances, and it can advance at most n times overall, so the inner shrink loop runs at most n times summed over every outer step. That is an amortized argument, and stating it is usually the point of the question.
  - question: When does a sliding window stop working?
    answer: When adding an element can make an invalid window valid — negative numbers under a sum constraint are the standard example, since extending right might bring the sum back down. The window relies on validity being monotone in the window's extent. Without that, reach for prefix sums with a hash map, or a monotonic deque if the question is about maxima within a span.
  - question: How do you count subarrays with exactly k distinct values?
    answer: "Run the window twice: atMost(k) − atMost(k−1). \"At most k\" is monotone — shrinking can only help — so it fits a window, while \"exactly k\" does not. Inside the at-most pass, each time the window is valid it contributes right − left + 1 new subarrays ending at right."
---

# Sliding Window

## Two shapes

**Fixed size.** The window is k wide and stays k wide. Every step adds the element entering on the right and removes the one leaving on the left, so the running total is maintained rather than recomputed.

```python
def max_sum_k(nums, k):
    total = sum(nums[:k])
    best = total
    for right in range(k, len(nums)):
        total += nums[right] - nums[right - k]   # in, out
        best = max(best, total)
    return best
```

**Variable size.** The window grows on the right whenever it can and shrinks on the left whenever it must. This is the shape in the visualisation above, and the template is worth memorising:

```python
def shortest_at_least(nums, target):     # positive numbers only
    left = total = 0
    best = float("inf")
    for right, value in enumerate(nums):
        total += value                   # grow
        while total >= target:           # shrink while valid
            best = min(best, right - left + 1)
            total -= nums[left]
            left += 1
    return 0 if best == float("inf") else best
```

Grow unconditionally, shrink conditionally, record the answer where the window is valid. Almost every variable-window problem is this loop with a different notion of "valid".

## The monotonicity requirement

A window only works if validity behaves predictably as the window changes. Concretely: shrinking must never turn a valid window invalid, and the answer must be recoverable by sweeping the right edge once.

With positive numbers, "sum ≥ target" qualifies — removing an element can only lower the sum. Allow negatives and it collapses: a window that is too small might become valid by extending right, so the left edge has no rule to follow. That problem becomes prefix sums plus a hash map, which handles negatives because it compares totals rather than sliding a span.

The one-line check before writing any window: *if I remove an element from the left, can the window become more valid?* If the answer is no, stop and pick another tool.

## Why the nested loop is still O(n)

The shrink loop sits inside the grow loop, which looks quadratic and is not. The left edge never moves backwards, so across the entire run it advances at most n times total. The right edge does the same. Two counters, each bounded by n, gives at most 2n moves regardless of how the work is distributed between the loops.

This is the amortized argument, and it is the answer to "what's the complexity?" — not the number of loops on screen.

## Relation to two pointers

A sliding window *is* a two-pointer method; the difference is what the pointers mean. In [Two Pointers](/coding/02-two-pointers), the region between the pointers is what has not yet been ruled out, and the pointers converge. Here the region between them is the candidate answer, and both move the same direction. The invariant is inverted: there, everything outside the pointers is eliminated; here, everything inside them is valid.

## What to say in the interview

Name the window, name the invariant, then give the cost with its amortized justification: "the right edge visits each index once and the left edge only moves forward, so it is O(n) time and O(k) space." Then say why a window is legal here at all — that the validity condition is monotone. That last sentence is what separates a memorised template from an understood one.
