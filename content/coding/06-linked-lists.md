---
title: Linked Lists
order: 6
summary: "Nodes connected by references, with no index and no locality. Almost every question is pointer surgery: rewire the links without losing the rest of the list."
hardPart: "Doing it in place, in one pass, without dropping a reference — and knowing which cases a dummy head quietly removes."
viz: linked-list
tags: [pointers, in-place, recursion, fast-slow]
complexity:
  - op: Access by position
    time: O(n)
    space: O(1)
    note: No indexing — reaching node k means walking k links. This is the reason arrays beat lists for almost everything in practice.
  - op: Insert / delete given the node
    time: O(1)
    note: Rewiring two references. The catch is that finding the node is the O(n) part, so "O(1) deletion" assumes you already hold it.
  - op: Reverse in place
    time: O(n)
    space: O(1)
    note: Three pointers, one pass. The recursive version is the same time but O(n) stack space.
  - op: Cycle detection
    time: O(n)
    space: O(1)
    note: Fast and slow pointers replace a hash set of visited nodes, which would also be O(n) time but O(n) space.
reachFor:
  - The problem hands you a list and forbids extra memory — that is a request for pointer manipulation, not conversion to an array.
  - Insertions and deletions in the middle dominate, and you already hold a reference to the position.
  - "Implementing LRU caches, adjacency lists, or free lists, where splicing a node out must not move anything else."
  - Merging sorted sequences, where a dummy head makes the code uniform.
  - Anything asking for the middle, the nth from the end, or a cycle — those are fast/slow pointer questions.
pitfalls:
  - "Overwriting `curr.next` before saving it. The rest of the list becomes unreachable instantly, and the function returns a list of one."
  - "Returning the wrong variable after a loop. The loop ends when `curr` is None, so the new head is `prev` — returning `curr` returns None."
  - "Not using a dummy head. Deleting or inserting at the front is a special case in every implementation that lacks one, and it is a free way to delete that branch."
  - "Advancing a fast pointer without checking both `fast` and `fast.next`. One missing check and a two-step hop dereferences None on an even-length list."
  - Assuming a list is a good default. Random access, iteration speed and memory overhead all favour arrays; lists earn their place only when splicing matters.
followUps:
  - question: Reverse it recursively — what changes?
    answer: "The logic inverts: recurse to the end first, then rewire on the way back, with `head.next.next = head` and `head.next = None`. Time is still O(n), but it uses O(n) stack space and will overflow on a long list, which is the real answer to \"which would you ship\". The iterative version is preferred for exactly that reason."
  - question: Why does a dummy head help?
    answer: It removes the "is this the first node?" branch. With a dummy in front, deleting, inserting, and merging all operate on `prev.next` uniformly — including at position zero — and you return `dummy.next` at the end. It costs one node and deletes an entire class of edge case, which is usually a good trade in an interview.
  - question: Find the middle in one pass.
    answer: Advance slow by one and fast by two; when fast reaches the end, slow is at the middle. For an even count, whether you get the first or second middle depends on the loop condition — `while fast and fast.next` lands on the second, `while fast.next and fast.next.next` on the first. Say which one your loop gives, because problems usually care.
  - question: Detect the cycle and return its entry node.
    answer: Run fast and slow until they meet inside the cycle. Then reset one pointer to the head and advance both one step at a time; they meet at the cycle's entry. It works because the distance from the head to the entry equals the distance from the meeting point to the entry, modulo the cycle length — Floyd's algorithm, O(n) time and O(1) space.
---

# Linked Lists

## What the structure actually costs

A node holds a value and a reference. That buys O(1) splicing and costs everything else: no indexing, no binary search, no cache locality, and a pointer's worth of overhead per element. In production an array is almost always the better default. In interviews, a linked list is a way to test whether you can manipulate references carefully — which is why nearly every question is "do it in place, in one pass".

## The three-pointer pattern

Reversal is the canonical exercise, and the shape recurs everywhere:

```python
def reverse(head):
    prev, curr = None, head
    while curr:
        next = curr.next    # 1. save what you are about to overwrite
        curr.next = prev    # 2. rewire
        prev, curr = curr, next   # 3. advance
    return prev             # curr is None here
```

Save, rewire, advance. Skip step one and the list is destroyed; skip step three and you loop forever. The invariant: everything behind `curr` is reversed and terminates at None, and everything from `curr` onward is the original list, untouched.

## The dummy head

Insertions and deletions at position zero are a special case in every naive implementation. A sentinel node removes it:

```python
def remove_all(head, target):
    dummy = ListNode(0, head)
    prev = dummy
    while prev.next:
        if prev.next.value == target:
            prev.next = prev.next.next    # works at the front too
        else:
            prev = prev.next
    return dummy.next
```

The same trick makes merge functions symmetric — build onto a dummy tail and return `dummy.next` — which is why it shows up in merge-two-lists, merge-k-lists, and partition problems.

## Fast and slow

Two pointers at different speeds turn positional questions into one pass with no extra memory. This is the [Two Pointers](/coding/02-two-pointers) technique applied to references instead of indices:

```python
def middle(head):
    slow = fast = head
    while fast and fast.next:     # both checks, every time
        slow, fast = slow.next, fast.next.next
    return slow

def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
        if slow is fast:
            return True
    return False
```

For "nth from the end", the same idea with a fixed gap: advance one pointer n steps, then move both until the leader falls off the end.

## What to say in the interview

Draw the three nodes you are about to rewire before writing any code — the code follows from the picture, and the picture catches the dropped reference. Then state the costs: O(n) time, O(1) space for the iterative version, versus O(n) stack for the recursive one. If the problem touches the front of the list, say you are adding a dummy head and why.
