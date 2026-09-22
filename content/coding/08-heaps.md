---
title: Heaps
order: 8
summary: "A tree stored in an array that keeps only one promise: the best element is at the front. Cheaper than sorting, and the right answer whenever a problem says top-k, median, or merge."
hardPart: "Recognising that the problem needs the extreme repeatedly, not the full order — and getting the heap's direction and size right."
viz: heap
tags: [heap, priority-queue, top-k, streaming]
complexity:
  - op: Peek the minimum
    time: O(1)
    space: O(n)
    note: "It is the root, which is index 0. This is the operation the whole structure exists for."
  - op: Push / pop
    time: O(log n)
    note: "One swap per level while sifting up or down, and the tree's height is log n because it is kept complete."
  - op: Build from an array (heapify)
    time: O(n)
    note: "Sifting down from the last parent backwards. Most nodes are near the bottom and travel almost no distance, so the sum is linear — not O(n log n)."
  - op: Top-k over n elements
    time: O(n log k)
    space: O(k)
    note: "A heap of size k, pushing each element and evicting the worst. Sorting everything would be O(n log n) and O(n) space."
reachFor:
  - "\"K largest\", \"k closest\", \"k most frequent\" — anything top-k, especially over a stream too big to sort."
  - Scheduling by priority — the next task, the next expiring item, the next event in a simulation.
  - Merging k sorted sequences, where the heap holds one candidate per sequence.
  - "Running median, with a max-heap for the low half and a min-heap for the high half."
  - Dijkstra and A*, where the frontier must always yield the cheapest node next.
pitfalls:
  - "Using the wrong direction. For the k largest you need a min-heap of size k, so the weakest survivor is the one you evict — the instinct to use a max-heap is backwards."
  - "Treating the array as sorted. Beyond the root, a heap promises nothing; printing it and expecting order is a common surprise."
  - "Building with n pushes when heapify would do. Both give a valid heap, but one is O(n log n) and the other O(n)."
  - "Forgetting that Python's heapq is a min-heap only. Negate the values, or wrap them in a tuple with an inverted key, and say so out loud."
  - "Sifting down to an arbitrary child. You must descend into the smaller child in a min-heap, or the sibling ends up out of order."
followUps:
  - question: Why is heapify O(n) when each sift-down is O(log n)?
    answer: "Because almost no node actually travels log n levels. Half the nodes are leaves and move zero, a quarter move at most one, an eighth at most two. The total is n × Σ(h / 2ʰ), a series that converges to 2n. The O(n log n) estimate assumes every node pays the worst case, which only the root does."
  - question: Find the k largest elements in a stream.
    answer: "Keep a min-heap capped at size k. Push each element; when the size exceeds k, pop — which removes the smallest survivor, so the heap always holds the k largest seen so far. O(n log k) time and O(k) space, and it works on a stream that never fits in memory. Sorting is only preferable when k approaches n."
  - question: Maintain a running median.
    answer: "Two heaps: a max-heap for the lower half and a min-heap for the upper half, kept balanced to within one element. The median is the top of the larger heap, or the average of the two tops when they are equal in size. Insertion is O(log n) and reading the median is O(1); the fiddly part is rebalancing after every insert, and that is where the bugs live."
  - question: Heap or balanced BST?
    answer: "A heap gives O(1) access to one extreme and cheaper constants; a BST keeps everything ordered, supporting range queries, predecessors and successors, and ordered iteration at O(log n). If the problem only ever asks for the best element, a heap is smaller, simpler and faster. The moment it asks \"what is just above x\", the heap cannot answer and you need the tree."
---

# Heaps

## A weaker promise, bought cheaper

Sorting an array gives total order for O(n log n). Most problems do not need that — they need *the best element, repeatedly*. A heap provides exactly that and nothing more: the root is the minimum (or maximum), and siblings are unordered.

The structure is a complete binary tree, which means it can be stored in a plain array with no pointers at all:

```
index:   0   1   2   3   4   5   6
value:   2   5   8   9   6  12  10

parent(i) = (i - 1) // 2
left(i)   = 2i + 1
right(i)  = 2i + 2
```

Completeness is what makes that arithmetic valid, and it is why every insert goes at the end and every delete takes from the end.

## Two operations, mirrored

**Push**: append, then sift *up* while the parent is larger. **Pop**: take the root, move the last element into its place, then sift *down* into the smaller child while it is out of order. Both walk one path from root to leaf, so both are O(log n).

```python
import heapq

heap = []
heapq.heappush(heap, 5)
smallest = heapq.heappop(heap)
heapq.heapify(existing_list)          # O(n), in place
```

Use the library in an interview and say what it costs — nobody needs to watch you write sift-down unless they ask.

## The top-k pattern

The single most common heap question, and the direction is counterintuitive:

```python
def k_largest(nums, k):
    heap = []
    for value in nums:
        heapq.heappush(heap, value)
        if len(heap) > k:
            heapq.heappop(heap)      # drops the smallest survivor
    return heap                       # the k largest, unordered
```

A **min**-heap for the k **largest**. The root is the weakest element still in the running, so it is exactly what should be evicted when a better one arrives. Cost: O(n log k) time, O(k) space — better than sorting on both counts whenever k is small, and it works on a stream that does not fit in memory.

## Python's one-sided heap

`heapq` only does min-heaps. For a max-heap, negate on the way in and out, or push tuples:

```python
heapq.heappush(heap, -value)              # max-heap of numbers
heapq.heappush(heap, (-count, word))      # max by count, ties by word
```

The tuple form is also how you attach a payload to a priority, which is what Dijkstra's frontier needs.

## What to say in the interview

Say why a heap instead of sorting: "I only need the extreme repeatedly, so I can pay O(log n) per element instead of ordering everything." For top-k, name the direction and the reason — "min-heap of size k, so the root is the one to evict". Then give the cost as O(n log k) with O(k) space, and mention heapify being O(n) if you are building from an existing array.
