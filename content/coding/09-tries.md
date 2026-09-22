---
title: Tries
order: 9
summary: "A tree keyed by characters, where the path spells the word. The structure that answers prefix questions a hash map cannot answer at all."
hardPart: "Knowing when the prefix structure is worth its memory — and remembering that \"a node exists\" and \"a word ends here\" are different facts."
viz: trie
tags: [tree, string, prefix, autocomplete]
complexity:
  - op: Insert / search a word
    time: O(L)
    space: O(L)
    note: "L is the word's length. Independent of how many words the trie holds — adding a million words does not slow a lookup."
  - op: Prefix check (startsWith)
    time: O(p)
    note: "Walk the p characters of the prefix. A hash set cannot do this at all without scanning every key."
  - op: Collect all words with a prefix
    time: O(p + k)
    note: "Walk to the prefix node, then traverse its subtree, where k is the total size of the matches. This is autocomplete."
  - op: Space for n words
    space: O(Σ distinct prefixes)
    note: "Overlapping words share nodes, so a dictionary compresses well; random strings share nothing and a trie costs more than a hash set."
reachFor:
  - "Autocomplete and typeahead — any \"words starting with…\" query."
  - Spell-checking and dictionary membership over a fixed word list.
  - Word-search and board games, where a trie prunes a backtracking search the moment a prefix goes nowhere.
  - "Longest-prefix matching — IP routing tables are tries, as are URL routers."
  - "Streaming or repeated lookups over the same corpus, where the build cost is amortised over many queries."
pitfalls:
  - "Forgetting the end-of-word flag. Without it, inserting \"cat\" makes \"ca\" and \"c\" look like words too, and search silently returns true for every prefix."
  - "Reaching for a trie when a hash set would do. If the only question is exact membership, a set is O(1) and far smaller — the trie earns its place on prefix queries."
  - "Allocating a fixed 26-slot array per node out of habit. That is fast but wasteful for sparse tries; a dictionary of children is usually the better default, and worth saying which you chose and why."
  - "Ignoring the alphabet size in the complexity. Collecting every word under a prefix is O(p + k), and quoting it as O(p) hides the part that actually dominates for short prefixes."
  - "Deleting a word by removing nodes without checking. A node on the path may be shared with another word or carry its own flag — remove only nodes that end up childless and unflagged."
followUps:
  - question: Trie or hash map?
    answer: "For exact lookups, the hash map wins on both time and memory — O(1) rather than O(L), with no per-character nodes. The trie wins the moment the question involves prefixes: \"starts with\", \"longest matching prefix\", \"all completions\". Hashing deliberately destroys the structure prefixes depend on, so a hash map can only answer those by scanning every key."
  - question: How does a trie speed up word search on a board?
    answer: "Backtracking over the grid without one explores every path to its full length. With a trie, the search carries the current trie node alongside the current cell, and the moment a prefix has no child the whole branch is abandoned. That converts an exponential search over paths into one bounded by the dictionary's shape, and it is the standard answer for Word Search II."
  - question: How would you delete a word?
    answer: "Walk down to the terminal node and clear its word flag, then unwind back up removing any node that is now childless and unflagged. Stopping early is the bug: a node may still be part of another word, and removing it silently deletes that one too. If deletions are frequent, keeping a child count per node makes the check O(1) per level."
  - question: How do you make it smaller?
    answer: "Compress chains of single-child nodes into one edge holding a substring — a radix tree, which is what routing tables use. Another option is a DAWG, which also merges identical suffixes and turns the tree into a DAG; that is much smaller but no longer supports per-word payloads. Both trade build complexity for memory, which is the right trade only when the corpus is fixed."
---

# Tries

## The path is the key

In a hash map the key is hashed and thrown into a bucket. In a trie the key is *spelled out*: one character per edge, so the path from the root to a node is the prefix that node represents. Nothing about a node says which word it belongs to — the route there does.

That single change is what makes prefix queries possible. Words sharing a prefix share a path, so "everything starting with `ca`" is a subtree, not a search.

```python
class Node:
    def __init__(self):
        self.kids = {}          # char -> Node
        self.is_word = False    # a word ends here

def insert(root, word):
    node = root
    for ch in word:
        node = node.kids.setdefault(ch, Node())
    node.is_word = True
```

## Two different questions

`is_word` is not bookkeeping — it is what separates the two queries a trie answers:

```python
def find(root, key):                 # returns the node, or None
    node = root
    for ch in key:
        if ch not in node.kids:
            return None
        node = node.kids[ch]
    return node

def search(root, word):
    node = find(root, word)
    return node is not None and node.is_word     # exact word

def starts_with(root, prefix):
    return find(root, prefix) is not None        # any word with this prefix
```

Same walk, different final check. Drop the flag and every prefix becomes a word, which is the bug that makes a spell-checker accept `ca`.

## Where the payoff is

**Autocomplete** — walk to the prefix node, then collect the subtree:

```python
def completions(root, prefix):
    node, out = find(root, prefix), []
    if not node:
        return out
    def walk(node, path):
        if node.is_word:
            out.append(prefix + path)
        for ch, kid in node.kids.items():
            walk(kid, path + ch)
    walk(node, "")
    return out
```

**Pruning a search** — the more interesting use. In a board-search problem, carry the current trie node with the current cell; when a character has no child, that entire branch of the [backtracking](/coding/11-backtracking) search dies immediately instead of exploring to full depth. The dictionary becomes the pruner.

## What it costs

Every operation is O(L) in the length of the word and indifferent to the number of words — a trie over ten words and one over ten million cost the same per lookup. Memory is the trade: one node per distinct prefix, each with a children map. For a natural-language dictionary, the sharing is substantial; for random identifiers, there is no sharing and a hash set is smaller and faster.

## What to say in the interview

Lead with why the structure is justified: "the question is about prefixes, which a hash map cannot answer without scanning every key". Mention the end-of-word flag when you write the node class, because that is the detail interviewers watch for. Then give the cost as O(L) per operation with space proportional to distinct prefixes, and say when a hash set would have been the better call.
