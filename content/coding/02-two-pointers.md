---
title: Two Pointers
order: 2
summary: Two indices walking the same array under a rule that lets each move retire part of the search. The technique that collapses a nested loop into one pass — when the data has an order to exploit.
hardPart: Justifying the move. Anyone can write the loop; the signal is whether you can say what each step proves impossible.
viz: two-pointers
tags: [array, sorted, in-place, linked-list]
complexity:
  - op: Opposite ends (converge)
    time: O(n)
    space: O(1)
    note: Every comparison moves one pointer inward and never back, so the two together take at most n steps.
  - op: Sort first, then scan
    time: O(n log n)
    space: O(1)
    note: On unsorted input the sort dominates. Worth it when you need O(1) extra space, or when later steps want the sorted order anyway.
  - op: Read / write compaction
    time: O(n)
    space: O(1)
    note: The write pointer trails the read pointer, so filtering or dedup happens in place with no second array.
  - op: Fast / slow (cycle, midpoint)
    time: O(n)
    space: O(1)
    note: Replaces the hash set of visited nodes. Fast closes the gap on slow by one node per step, so they meet inside any cycle.
reachFor:
  - The array is sorted — or sorting it is free — and you need a pair, triple, or span with some property.
  - Filtering or de-duplicating in place, with no room for a second array.
  - Palindromes, reversals, merges — anything read from both ends at once.
  - "Linked list questions that name a position: the middle, the nth from the end, is there a cycle."
  - Container and trapping-water problems, where one side is provably the limiting one.
pitfalls:
  - Reaching for opposite-ends pointers on unsorted data. The whole method rests on "this value cannot work with anything left", and without order there is no such argument.
  - Getting the loop bound wrong. `while lo < hi` pairs distinct elements; `<=` lets an element pair with itself and changes a palindrome check's middle case.
  - Moving both pointers after a failed test. Only the side you have proven impossible may move — moving both can step over the answer.
  - Forgetting duplicates. 3Sum-style problems need an explicit skip after a hit, or the same triple comes back several times.
  - Sorting when the answer is an index. Sorting destroys the original positions, so either carry (value, index) pairs or solve it with a hash map instead.
followUps:
  - question: The array isn't sorted. What changes?
    answer: Either sort it — O(n log n) time, O(1) extra space, and you lose the original indices — or use a hash map, which is O(n) time and O(n) space and keeps indices. Pick the map when the answer is positional or the input is huge and unsorted; pick the sort when you need O(1) space, or when a later step (3Sum, dedup, merging) wants sorted order anyway.
  - question: Extend it to 3Sum.
    answer: "Sort, then fix the first index i and run the opposite-ends scan over the suffix after it. That is O(n²) time and O(1) extra space, versus O(n³) brute force. The part that gets missed under pressure is duplicate handling: skip repeated values at i, and after recording a hit advance both pointers past their duplicates."
  - question: Prove the opposite-ends scan cannot skip the answer.
    answer: The invariant is that any untested pair lies inside the window [lo, hi]. If nums[lo] + nums[hi] > target, then hi paired with anything at or above lo is also over target, so hi is in no solution and can be dropped. The mirror argument covers the under-target case. Each step removes exactly one index that has been proven impossible, so the pair, if it exists, is still in the window when the pointers meet.
  - question: Why do a fast and a slow pointer always meet in a cycle?
    answer: Once both are inside the cycle, fast gains exactly one node on slow per step, so the gap shrinks by one each time and must reach zero within the cycle's length — it cannot jump past, because a gap of one becomes a gap of zero. To find the cycle's entry, restart one pointer at the head and step both one at a time; they meet at the entry, because the distance from the head to the entry equals the distance from the meeting point to the entry, modulo the cycle length.
---

# Two Pointers

## Three shapes, one idea

Two pointers is not one algorithm; it is three patterns that share a justification. In all of them a second index exists so the code can avoid re-scanning what it already knows.

### Opposite ends — converge

The visualisation above. Start wide, compare, and move whichever side the comparison proved impossible. Sorting is what makes the proof work: "this value is too large even against the smallest candidate left" is only meaningful if you know what is left.

```python
def is_palindrome(s):
    lo, hi = 0, len(s) - 1
    while lo < hi:
        if s[lo] != s[hi]:
            return False
        lo, hi = lo + 1, hi - 1
    return True
```

### Read and write — compact in place

Both pointers move the same direction at different speeds. The read pointer inspects every element; the write pointer marks where the next keeper goes. Everything before the write pointer is the finished answer, which is the invariant worth saying out loud.

```python
def remove_duplicates(nums):       # nums is sorted
    write = 1
    for read in range(1, len(nums)):
        if nums[read] != nums[write - 1]:
            nums[write] = nums[read]
            write += 1
    return write                   # nums[:write] is the answer
```

This is the shape behind "remove element", "move zeroes", and most in-place filtering. The array is rewritten as it is read, with no second buffer.

### Fast and slow — find structure in a list

One pointer takes two steps for the other's one. The gap between them *is* the computation: after the fast pointer reaches the end, the slow one is at the middle; if a cycle exists, the gap closes and they collide.

```python
def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
        if slow is fast:
            return True
    return False
```

The alternative — a hash set of visited nodes — is also O(n) time but O(n) space. Being asked for O(1) space is the tell.

## The argument that makes it work

Every two-pointer solution has a sentence of the form *"moving this pointer discards only pairs that cannot be the answer."* If you cannot produce that sentence, the loop is a guess.

For the sorted pair scan it runs: `nums[lo] + nums[hi] > target` means `hi` is too large even against the smallest remaining value, so no surviving pair contains `hi`. One comparison retires an entire row of the pair matrix — which is exactly where the factor of n goes.

## Two pointers or sliding window?

They look alike and answer different questions.

| | Two pointers | Sliding window |
| --- | --- | --- |
| Pointers move | Toward each other, or at different speeds | Both forward, left trails right |
| Region of interest | The pair or the prefix behind `write` | The contiguous span between them |
| Typical question | "Find the pair / compact the array / detect the cycle" | "Longest or smallest run satisfying X" |
| Needs sorted input | Usually, for the opposite-ends form | No — it needs a monotone window condition |

A sliding window is really the same machinery with a different invariant: instead of "everything outside is eliminated", it is "everything inside is valid".

## What to say in the interview

State the invariant before the code, and give the cost with its condition: O(n) time and O(1) space, *given sorted input*, versus O(n) time and O(n) space for the hash map version that does not need sorting. Naming that trade is usually what the question was testing.
