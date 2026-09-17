---
group: "tech"
order: 15
title: "ZooKeeper"
role: "Coordination service"
summary: "A small, strongly consistent store for the decisions a cluster must agree on: who leads, who is alive, who owns what."
tags: ["zookeeper", "consistency", "reliability", "concurrency", "sharding"]
facts:
  - label: "What it is"
    value: "A replicated store for tiny amounts of cluster metadata"
  - label: "Data"
    value: "A tree of znodes, each at most a megabyte, usually far less"
  - label: "Consensus"
    value: "ZAB over 3 or 5 servers; writes commit on a majority"
  - label: "Reads"
    value: "Any member, possibly stale — `sync` first when it matters"
  - label: "Primitives"
    value: "Ephemeral znodes, sequential znodes, one-shot watches"
  - label: "Alternatives"
    value: "etcd (Raft, behind Kubernetes) and Consul — say \"ZooKeeper or etcd\""
capabilities:
  - title: "Leader election, the canonical recipe"
    body: |-
      Every candidate creates an ephemeral sequential node under `/election`. The lowest sequence number leads; each other candidate watches only the node directly below it, so a failure wakes exactly one client instead of a herd.

      If the leader dies its ephemeral node disappears, and the next in line is promoted. Be able to sketch this.
  - title: "Membership and discovery"
    body: |-
      Each worker registers an ephemeral node under `/workers` with its address, and a coordinator watches the directory — so joins and failures arrive as events rather than as a polled health check.
  - title: "Partition assignment"
    body: |-
      The elected coordinator writes the shard-to-worker map into a znode; workers watch it and pick up their assignments.

      This is how Kafka (before KRaft), HBase and Druid distribute work, and a good pattern to borrow when a design needs "exactly one process per shard".
  - title: "Locks, with fencing"
    body: |-
      A lock is an ephemeral sequential node plus a watch on the predecessor. Critically, the sequence number is a **fencing token**: the holder passes it to any resource it writes, and the resource rejects anything with a lower token than the highest it has seen.

      That is what makes the lock safe when a process pauses for a long GC and wakes believing it still holds it — the property a Redis lock does not give you.
  - title: "Configuration that must be consistent"
    body: |-
      Feature flags, cluster topology, schema versions. Everyone watches the same znode and converges on the same value.
useWhen:
  - "The design contains the phrase **\"exactly one\"**: one scheduler, one writer per shard, one coordinator, one active node in an active-passive pair"
  - "You need cluster membership with real failure detection rather than polled health checks"
  - "A lock whose failure would cost money, so it needs a fencing token"
avoidWhen:
  - "As a key-value store or a queue — every write goes through one leader"
  - "For anything high-volume: it is built for thousands of metadata writes per second, not your traffic"
  - "\"Roughly one worker at a time\" is enough: a lease row in Postgres with an expiry is simpler, and saying so scores"
probes:
  - question: "Do you actually need it?"
    answer: "The best answer often starts by ruling it out: a database lease, a partitioned Kafka consumer group, or idempotent work that tolerates being done twice all avoid another system."
  - question: "How do you prevent split brain?"
    answer: "A majority quorum: a partitioned minority cannot commit writes, so there is one leader. The harder half is that a merely *slow* leader still thinks it leads — which is what fencing tokens are for."
  - question: "Why is a Redis lock not equivalent?"
    answer: "No consensus, no fencing token, and asynchronous replication, so a failover can lose the lock's existence. Fine for deduplicating work, not for protecting money."
  - question: "A GC pause expired the session."
    answer: "The ephemeral node drops and a needless failover happens. Session timeouts are tuned against that, and the work has to be safe to restart."
  - question: "How much can it hold?"
    answer: "Small data, a few thousand writes per second, one leader. A design that puts per-request state in it is the mistake being probed."
  - question: "Does Kafka still use it?"
    answer: "No — Kafka moved its metadata to its own Raft quorum, KRaft. Knowing that is a cheap signal your knowledge is current."
---

# ZooKeeper

## How it works

ZooKeeper is not a database. It is a replicated, strongly consistent store for
tiny amounts of metadata that a distributed system must agree on: which node is
the leader, which nodes are alive, which worker owns which partition.

An ensemble of typically three or five servers runs the **ZAB** protocol: all
writes go through a leader and are committed once a majority have them, so writes
are linearizable and survive the loss of a minority.

Two primitives do most of the work. **Ephemeral znodes** exist only while the
client's session is alive — the client heartbeats, and if it stops, the node
vanishes, which is failure detection with no extra machinery. **Sequential znodes**
get a monotonically increasing suffix, which gives a total order. **Watches** let a
client be notified once when a znode changes, instead of polling.

## Leader election, drawn

```mermaid
flowchart TB
    C([Every candidate]) -- "create ephemeral<br/>sequential znode" --> Tree

    subgraph Tree ["/election"]
        direction TB
        N1["node-…17<br/>lowest → leader"]
        N2["node-…18"]
        N3["node-…19"]
        N2 -. "watches" .-> N1
        N3 -. "watches" .-> N2
    end

    N1 --> Work["Leader writes<br/>shard → worker map"]
    Work --> W["Workers watch it<br/>and take assignments"]

    classDef hot stroke:#e8a33d,stroke-width:2px
    class N1 hot
```

Each candidate watches only its predecessor, so one failure wakes one client
rather than the whole herd. The sequence number doubles as a **fencing token**:
pass it to whatever the leader writes to, and a paused leader that wakes up late
is rejected.

## Where it fits in a design

Name it lightly. In most designs one sentence is enough — *"a ZooKeeper or etcd
ensemble holds the shard assignment and elects the coordinator"* — and the rest of
your time is better spent on the data path.

> It deserves more only when the design is *about* coordination: a distributed
> scheduler, a custom sharded store, or anything where you are building a cluster
> rather than using one.
