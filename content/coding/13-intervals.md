---
title: Intervals
order: 13
summary: "Ranges with a start and an end. Sort them the right way and almost every question becomes one linear pass — the difficulty is choosing which end to sort by."
hardPart: "Picking the sort key. Merging wants start times, scheduling wants end times, and the wrong choice turns a five-line solution into a wrong one."
viz: intervals
tags: [sorting, greedy, sweep-line, scheduling]
complexity:
  - op: Merge overlapping intervals
    time: O(n log n)
    space: O(n)
    note: "The sort dominates; the merge pass is O(n). If the input is already ordered by start, the whole thing is linear."
  - op: Insert into a sorted interval list
    time: O(n)
    note: "No sort needed — walk once, emitting everything before, merging everything that overlaps, then everything after."
  - op: Maximum non-overlapping subset
    time: O(n log n)
    note: "Sort by end time and greedily keep every interval that starts after the last kept one ends. Sorting by start is the classic wrong answer."
  - op: Sweep line over endpoints
    time: O(n log n)
    space: O(n)
    note: "Split each interval into a +1 start and a −1 end event, sort, and accumulate. Answers \"maximum concurrency\" — how many meeting rooms."
reachFor:
  - Calendars and bookings — conflicts, free slots, double-bookings, room allocation.
  - Merging or compressing ranges — IP blocks, time series windows, version ranges.
  - "\"How many at once\" questions, which are sweep-line counting rather than merging."
  - Choosing the largest compatible set of activities, which is a greedy on end times.
  - Range coverage — is this span fully covered, and what is the smallest set that covers it.
pitfalls:
  - "Sorting by the wrong endpoint. Merging needs start order; maximum non-overlapping needs end order. They are different problems and the sort is the whole difference."
  - "Not asking whether touching counts. Does [1,3] overlap [3,5]? Half-open ranges say no, closed ranges say yes, and the comparison changes from < to ≤."
  - "Comparing against the original interval instead of the merged one. After extending, the open interval's end is what the next candidate must be tested against."
  - "Extending with the new end instead of the larger end. A fully contained interval would otherwise shrink the merged range."
  - "Building a fresh list when the question asks for it in place, or mutating the caller's input when it does not. Say which you are doing."
followUps:
  - question: How many meeting rooms are needed?
    answer: "This is a counting question, not a merging one, so sweep the endpoints: turn every interval into a +1 at its start and a −1 at its end, sort the events, and track a running total — the maximum that total reaches is the answer. Ties matter: an end at time t should be processed before a start at t if a room can be reused immediately. The alternative is a min-heap of end times, pushing each interval and popping the ones that have finished, where the heap's size is the room count."
  - question: Maximum number of non-overlapping intervals — why sort by end?
    answer: "Because finishing earliest leaves the most room for everything after it. The exchange argument: take any optimal solution, and replacing its first interval with the earliest-ending one cannot make things worse, since it ends no later and therefore blocks no more. Sorting by start fails on a single long interval that begins first and swallows several short ones; sorting by length fails too."
  - question: Insert an interval into an already-sorted list.
    answer: "Three phases, no sort: copy every interval that ends before the new one starts, then merge the new interval with every interval that overlaps it by taking the minimum start and maximum end, then copy the rest. O(n) time and one pass. The trap is emitting the merged interval too early — it is not finished until the first interval that starts after its end."
  - question: What if intervals arrive as a stream and cannot all be held?
    answer: "Keep them in a structure ordered by start — a balanced BST or a sorted container — and on each arrival look up only the neighbours that could touch it, merging in place at O(log n) per insert. If only aggregates are needed, a sweep with a running counter or a segment tree over discretised endpoints avoids storing the intervals at all. The right answer depends on whether the question wants the merged set or a statistic about it."
---

# Intervals

## Sort first, then one pass

Unsorted intervals force pairwise comparison, which is O(n²) and still leaves chains — A overlaps B, B overlaps C — to untangle. Sorting removes both problems: afterwards, anything that overlaps the interval you are building must start before it ends, so a single left-to-right pass is enough.

```python
def merge(intervals):
    intervals.sort(key=lambda i: i[0])         # by start
    out = []
    for start, end in intervals:
        if out and start <= out[-1][1]:        # overlaps the open interval
            out[-1][1] = max(out[-1][1], end)  # max, not end
        else:
            out.append([start, end])
    return out
```

Two details carry the correctness. The comparison is against `out[-1][1]` — the *merged* end, not the original interval's. And the extension takes `max`, so an interval fully contained in the open one does not shrink it.

## The sort key is the decision

| Question | Sort by | Why |
| --- | --- | --- |
| Merge overlapping | start | Overlap can then only come from the left |
| Maximum non-overlapping set | end | Finishing early leaves the most room for the rest |
| Minimum rooms / max concurrency | endpoints as events | It is a counting problem, not a merging one |
| Insert into a sorted list | already sorted | Three phases, no sort at all |

Sorting by start for the scheduling problem is the classic wrong answer: one long interval that starts first blocks several short ones that would all have fitted.

```python
def max_non_overlapping(intervals):
    intervals.sort(key=lambda i: i[1])          # by END
    count, last_end = 0, float("-inf")
    for start, end in intervals:
        if start >= last_end:                   # compatible
            count += 1
            last_end = end
    return count
```

## Sweep line

When the question is "how many are active at once", stop thinking about intervals and think about events:

```python
def min_rooms(intervals):
    events = []
    for start, end in intervals:
        events.append((start, 1))               # a meeting begins
        events.append((end, -1))                # a meeting ends
    events.sort()                               # -1 sorts before +1 at the same time
    active = best = 0
    for _, delta in events:
        active += delta
        best = max(best, active)
    return best
```

The tie-breaking is the subtle part: at time t, ends must be processed before starts if a room freed at t can be reused at t. Sorting `(time, delta)` gets that for free, because −1 < +1.

## The boundary question

Does `[1,3]` overlap `[3,5]`? For meeting rooms, usually not — one ends exactly as the other begins. For merging physical ranges, usually yes. The code differs by one character (`<` versus `<=`), so ask before writing it. Interviewers add adjacent intervals to the test input specifically to see whether the question gets asked.

## What to say in the interview

Say the sort key and the reason in the same sentence — "sort by end time, because finishing earliest leaves the most room". Ask about touching endpoints. Then give the cost as O(n log n) dominated by the sort, and note that a pre-sorted input makes it linear. If the question is about concurrency rather than merging, say you are switching to a sweep over endpoints and why.
