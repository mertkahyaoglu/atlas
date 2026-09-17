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
concepts:
  - "**Not a database** — tiny metadata only: a few thousand writes a second, all through one leader"
  - "**Majority quorum** — writes commit on a majority, so a partitioned minority cannot invent a second leader"
  - "**Ephemeral znodes** vanish when a session stops heartbeating, which is failure detection with no extra machinery"
  - "**Sequential znodes** get a monotonic suffix, giving a total order — and a fencing token"
  - "**Watches** notify once when a znode changes, so joins and failures arrive as events instead of polls"
  - "**Leader election** — lowest sequence number leads, each candidate watches only its predecessor"
  - "**Fencing tokens** — the resource rejects a token lower than the highest it has seen, which is what a Redis lock lacks"
  - "**Rule it out first** — a database lease, a Kafka consumer group, or idempotent work often removes the need"
  - "**Kafka moved off it** to its own Raft quorum, KRaft; knowing that keeps your answer current"
---

# ZooKeeper

## Use cases

### Electing exactly one leader

The canonical recipe, and the one to be able to sketch. Every candidate creates
an ephemeral sequential node; the lowest sequence number leads. Each other
candidate watches only the node directly below it, so one failure wakes one
client rather than a herd.

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

    N1 -. "session dies → znode vanishes<br/>18 is woken and takes over" .-> N2

    classDef hot stroke:#e8a33d,stroke-width:2px
    class N1 hot
```

### Knowing who is alive, and who owns which shard

Workers register ephemeral nodes; the elected coordinator watches that directory
and writes a shard-to-worker map into a znode; workers watch the map. Joins and
failures arrive as events, and "exactly one process per shard" holds without
anybody polling.

```mermaid
flowchart TB
    W1(["Worker 1"]) -- "ephemeral /workers/w1" --> ZK["ZooKeeper ensemble<br/>3 or 5 servers"]
    W2(["Worker 2"]) -- "ephemeral /workers/w2" --> ZK
    W3(["Worker 3 · dies"]) -. "znode vanishes" .-> ZK
    ZK -- "watch fires" --> Coord["Coordinator<br/>the elected leader"]
    Coord -- "write /assignments" --> ZK
    ZK -- "watch fires" --> W1
    ZK -- "watch fires" --> W2

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Coord hot
```

### A lock that survives a GC pause

The reason to use a consensus system rather than a cache for a lock that protects
money. The sequence number is a **fencing token**: the resource remembers the
highest it has seen, so a paused holder that wakes up late is rejected instead of
writing over the new holder's work.

```mermaid
flowchart TB
    A(["Holder A · token 17"]) -- "write with token 17" --> R[("Resource<br/>remembers highest token")]
    A -. "long GC pause<br/>session expires, lock released" .-> Pause["A is frozen"]
    B(["Holder B · token 18"]) -- "write with token 18" --> R
    Pause -. "wakes up, writes with token 17" .-> R
    R -. "17 < 18 → rejected" .-> Pause

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class R db
    class R hot
```

### Config every node must agree on

Feature flags, cluster topology, schema versions: written once through the
leader, watched by everyone, and converged on within a heartbeat. Small, rarely
written, and read by every node — which is precisely the shape it is built for.

```mermaid
flowchart TB
    Admin(["Operator"]) -- "set /config/topology" --> Leader["ZAB leader"]
    Leader -- "commit on a majority" --> F1["Follower"]
    Leader --> F2["Follower"]
    F1 -- "watch fires" --> S1["Service A"]
    F2 -- "watch fires" --> S2["Service B"]
    S1 -. "reads may be stale;<br/>sync first when it matters" .-> F1

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Leader hot
```
