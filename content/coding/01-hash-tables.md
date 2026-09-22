---
title: Hash Tables
order: 1
summary: An array you index by content instead of position. The one structure that turns a nested loop into a single pass, and the one whose O(1) comes with conditions.
hardPart: Whether you can say why it is O(1) — and name the case where it is not — rather than reciting the number.
viz: hash-table
tags: [array, hashing, set, map]
complexity:
  - op: Lookup / insert / delete
    time: O(1)
    space: O(n)
    note: Average case. One hash, one array index, one very short bucket — provided the hash spreads keys and the load factor stays low.
  - op: Lookup / insert / delete
    time: O(n)
    note: Worst case — every key lands in one bucket, from a poor hash or crafted input. Java treeifies long buckets to claw this back to O(log n).
  - op: Resize
    time: O(n)
    note: Doubling rehashes every key. It happens once per doubling, so spread across the inserts that caused it, inserts stay amortized O(1).
  - op: Iterate all entries
    time: O(n + m)
    note: m is the bucket count — you walk empty buckets too. A big, mostly-empty map iterates slower than its entry count suggests.
reachFor:
  - "\"Have I seen this before?\" — a set answers it in constant time."
  - Counting occurrences of anything — character, word, id, bucket.
  - "\"Find the pair that sums to k\" — store what you have seen, look up the complement."
  - Grouping by a derived key — an anagram signature, a prefix, a rounded timestamp.
  - Any nested loop whose inner loop is just a search over the same data.
pitfalls:
  - Mutating a key after inserting it. The bucket was chosen from the old hash, so the entry becomes unreachable — it is still in the map, but lookup goes to the wrong bucket. Keys must be immutable.
  - Saying "O(1)" with no conditions. Say average case, assume a reasonable hash and a bounded load factor, and be ready to name the O(n) collision worst case — that is the answer interviewers are listening for.
  - Relying on iteration order. Python dicts preserve insertion order since 3.7, most other languages promise nothing, and no hash map gives you sorted order. If order matters, you want a different structure.
  - Reaching for a map when the keys are already 0..n-1. An array indexes directly, with no hashing and far better cache locality.
  - Ignoring the constant factor. A map entry costs buckets, pointers and often boxed keys — several times the size of the raw data, with a pointer chase per lookup.
followUps:
  - question: A hash map is unexpectedly slow in production. What do you look at first?
    answer: Key distribution, then load factor, then the cost of hashing and comparing the keys themselves. Clustered hashes turn lookups into list walks; a map sized just under a resize threshold can thrash on doubling; and long string keys make both hash() and == expensive even when the buckets are perfectly spread.
  - question: How would you make the worst case better than O(n)?
    answer: Replace the bucket's linked list with a balanced tree once it exceeds a threshold, which bounds a bucket walk at O(log n). Java's HashMap does exactly this, treeifying a bucket at 8 entries and reverting when it shrinks. The other half of the answer is a randomly seeded hash, so an attacker cannot force the collisions in the first place.
  - question: Chaining or open addressing?
    answer: Chaining stores a list per bucket — simple deletes, and it degrades gracefully past a load factor of 1. Open addressing stores entries in the array itself and probes forward — no per-entry allocation and much better cache locality, but deletions need tombstones and performance falls off a cliff above roughly 0.7 load. Open addressing wins on speed for read-heavy maps, chaining wins on predictability.
  - question: Why is a hash map a denial-of-service vector?
    answer: If the hash is deterministic and public, an attacker can craft thousands of keys that collide into one bucket, turning every insert into an O(n) walk and an O(n) request into O(n²). The fix is a per-process random seed and a hash designed for it, such as SipHash — which is why Python and Rust randomize hashing by default.
---

# Hash Tables

## How it actually works

Three moving parts, and the visualisation above is all of them: an array, a hash function, and a rule for what to do when two keys want the same cell.

The hash function is the whole idea. It turns a key of any shape into an integer, and `% len(buckets)` folds that integer into a valid index. Because it is deterministic, `get` can recompute the same index that `put` used — so finding a key costs the same as computing it, and nothing is searched.

Everything else is damage control. Collisions are not an edge case to engineer away: with 2⁶⁴ possible keys and 8 buckets, they are arithmetic. Chaining handles them by storing a list per bucket, which is why the real cost of a lookup is *hash, jump, then walk a very short list*. Keeping that list short is what the load factor is for — cross about 0.75 and the table doubles, rehashing every key.

That is the honest version of O(1): constant **given** a hash that spreads keys and a table that resizes. Both assumptions are the interview.

## The patterns it shows up in

Four shapes cover most hash-map questions. Recognising which one a problem is saves more time than any micro-optimisation.

**Seen-set** — "does this repeat?", "is it a duplicate?", "have we visited this node?"

```python
def has_duplicate(nums):
    seen = set()
    for n in nums:
        if n in seen:
            return True
        seen.add(n)
    return False
```

**Counter** — "most frequent", "can one string be rearranged into another", "is this a valid anagram".

```python
from collections import Counter

def is_anagram(a, b):
    return Counter(a) == Counter(b)
```

**Complement** — the pattern behind two-sum, and the clearest example of a map deleting a loop. The trick is to look up what you *need* rather than scan for it.

```python
def two_sum(nums, target):
    seen = {}                       # value -> index
    for i, n in enumerate(nums):
        if target - n in seen:      # O(1) instead of an inner loop
            return [seen[target - n], i]
        seen[n] = i
    return []
```

The brute force is two nested loops, O(n²). The map version is one pass, O(n) time and O(n) space — a textbook trade of memory for time, and worth naming out loud as exactly that.

**Grouping** — bucket items under a derived key.

```python
from collections import defaultdict

def group_anagrams(words):
    groups = defaultdict(list)
    for word in words:
        groups[tuple(sorted(word))].append(word)   # signature -> words
    return list(groups.values())
```

## Chaining versus open addressing

| | Chaining | Open addressing |
| --- | --- | --- |
| Collision | Append to the bucket's list | Probe forward for a free cell |
| Memory | A node per entry, pointer chasing | Entries live in the array, cache friendly |
| Deletion | Unlink — simple | Needs a tombstone, or later probes break |
| High load | Degrades gradually past 1.0 | Falls apart above ~0.7 |

Python's `dict` uses open addressing; Java's `HashMap` chains and treeifies long chains. Either answer is fine in an interview as long as the trade-off comes with it.

## Language notes worth having ready

- **Python** — `dict` and `set` are the same machinery. Keys must be hashable, which in practice means immutable: tuples work, lists do not. Insertion order is preserved and guaranteed since 3.7.
- **JavaScript** — use `Map`, not a plain object, when keys are not strings: object keys are coerced to strings, so `obj[1]` and `obj["1"]` are the same entry. `Map` also keeps insertion order and gives you `.size`.
- **Java** — `HashMap` is unordered, `LinkedHashMap` keeps insertion order, `TreeMap` keeps sorted order at O(log n). A key's `hashCode` and `equals` must agree, or entries go missing.

## When it is the wrong answer

A hash map buys constant-time access to *one* key. It gives you nothing that needs order: no "smallest above x", no range scan, no "next in sorted sequence", no sorted iteration. Those want a balanced tree or a heap. And when the keys are dense integers, an array is the same idea with none of the overhead — a hash map whose keys are `0..n-1` is a slower array with extra steps.
