---
title: Binary Search
order: 4
summary: "Halve the candidate set on every comparison. Trivial to describe, easy to write wrong, and far more general than \"find a value in a sorted array\"."
hardPart: "Recognising it when there is no array to search — the answer space itself is often the thing that is monotone."
viz: binary-search
tags: [sorted, divide-and-conquer, invariant, logarithmic]
complexity:
  - op: Search a sorted array
    time: O(log n)
    space: O(1)
    note: Each comparison discards half the candidates, so the cost is the number of halvings — 20 steps for a million elements.
  - op: Binary search on the answer
    time: O(log R · f)
    note: R is the width of the answer range and f the cost of the feasibility check. The check usually dominates, and it is the part to optimise.
  - op: Insert into a sorted array
    time: O(n)
    space: O(1)
    note: Finding the position is O(log n); the shifting is what costs. Repeated inserts want a tree or a heap instead.
  - op: Build the sorted order first
    time: O(n log n)
    note: Searching once does not justify a sort — that is O(n log n) to save O(n). It pays off from roughly log n searches onwards.
reachFor:
  - The input is sorted, or rotated-sorted, or can be treated as sorted along some axis.
  - "The answer is a number in a known range and \"is X feasible?\" is easier than \"what is the best X?\"."
  - "\"Minimum capacity / speed / days to …\" — the classic disguised form."
  - First or last index satisfying a condition, which the boundary template answers directly.
  - The input is too large to scan but cheap to probe — a file, an API, a version history.
pitfalls:
  - "Mixing the two templates. `while lo <= hi` pairs with `mid ± 1`; `while lo < hi` pairs with `hi = mid`. Cross them and you get an infinite loop or a skipped element."
  - Computing mid as (lo + hi) // 2 in a fixed-width language. It overflows for large indices; lo + (hi − lo) // 2 does not, and interviewers ask about it precisely because Python hides the problem.
  - "Returning early from the boundary form. \"First index that is true\" must keep probing left after a hit — returning on the first true gives some true index, not the first."
  - Assuming sorted input means binary search applies. What it needs is a monotone predicate; if the condition can flip true then false again, halving discards valid answers.
  - Forgetting the empty and single-element cases. Most off-by-one bugs only show up at n = 0 or 1, so walk those two before claiming the code is done.
followUps:
  - question: Write it so it returns the insertion point when the target is missing.
    answer: Use the boundary form over [0, n] rather than [0, n−1], with the predicate nums[i] >= target. It converges on the first index that is at least the target, which is exactly where the value would be inserted; n means "after everything". This is what bisect_left and lower_bound give you, and it is a better default than returning −1 because it answers both questions at once.
  - question: What does binary search on the answer mean?
    answer: "Instead of searching an array, search the range of possible answers. For \"minimum ship capacity to deliver in D days\", capacities form a monotone predicate: if capacity c works, every larger capacity works too. So binary search the capacity range and use a linear feasibility check as the test. Cost is O(log R) checks, each O(n), and the trick is proving the predicate is monotone."
  - question: How do you search a rotated sorted array?
    answer: At each step one half is still sorted — compare nums[lo] with nums[mid] to find which. If the target lies inside that sorted half's range, recurse there; otherwise recurse into the other half. Still O(log n). With duplicates the check degrades, because nums[lo] == nums[mid] no longer identifies the sorted side, and the worst case becomes O(n).
  - question: How do you convince yourself the loop terminates?
    answer: "Show the interval strictly shrinks every iteration. With lo = mid + 1 and hi = mid − 1 that is immediate. With hi = mid it is not: if mid could equal hi the interval would stall, which is why that form takes the floor of the midpoint and pairs with lo < hi — mid is always strictly less than hi, so hi moves. Naming this is usually enough to satisfy the question."
---

# Binary Search

## The invariant, not the loop

Every correct binary search maintains one sentence: *if the answer exists, it is inside [lo, hi]*. Every line of the loop exists to preserve it while making the interval smaller. Debug the invariant, not the arithmetic — nearly all binary search bugs are a step that discards an index the invariant said to keep.

## Two templates, and when each applies

**Exact match.** Use when the question is "is x here, and where?"

```python
def search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:                  # inclusive range
        mid = lo + (hi - lo) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1             # mid is ruled out
        else:
            hi = mid - 1
    return -1
```

**Boundary.** Use for everything else — first index that is at least x, smallest feasible capacity, first failing version.

```python
def first_true(lo, hi, ok):
    while lo < hi:                   # converge to one index
        mid = lo + (hi - lo) // 2
        if ok(mid):
            hi = mid                 # mid might be the answer — keep it
        else:
            lo = mid + 1             # mid is definitely not
    return lo
```

The boundary form is the one worth having in muscle memory. It never returns early, it always terminates with `lo == hi`, and it answers "find x" too, by checking the final index.

## Binary search on the answer

The array is a special case. What binary search actually requires is a predicate that is false up to some point and true after it:

```
index:      0  1  2  3  4  5  6  7
ok(index):  F  F  F  F  T  T  T  T
                       ^ the boundary
```

That pattern turns up constantly without an array in sight. "Minimum eating speed to finish in H hours": faster always works if slower did, so speeds are monotone — binary search the speed and use a simulation as `ok`. "Split the array into k parts minimising the largest sum": larger caps are always easier. The question becomes *what is the predicate, and why is it monotone*, and the search itself is boilerplate.

Cost is `O(log R)` calls to the check, where R is the width of the answer range. The check is usually O(n), so the total is O(n log R) — which is why an unnecessary O(n log n) sort inside the check is such an expensive mistake.

## Where the off-by-ones live

| Symptom | Cause |
| --- | --- |
| Infinite loop | `hi = mid` paired with `while lo <= hi`, so the interval stops shrinking |
| Misses the last element | `while lo < hi` in the exact-match form — the final single-element range is never tested |
| Returns any match, not the first | Returning on the first hit instead of continuing left |
| Overflow on huge inputs | `(lo + hi) // 2` in a fixed-width integer language |

Pick one template, keep its pairing intact, and test n = 0, n = 1 and "target not present" every time.

## What to say in the interview

State the invariant, say which template you are using and why, then give the cost — O(log n) comparisons, O(1) space. If the problem has no array, say the sentence that unlocks it out loud: "the feasibility check is monotone in this parameter, so I can binary search the parameter."
