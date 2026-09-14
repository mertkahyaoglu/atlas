"""Mermaid architecture diagrams for designs 11-15."""

DIAGRAMS = {
    "11-ticketmaster-booking": """flowchart TB
    Rush([500,000 users hit buy<br/>at 10:00:00 sharp]) --> CDNEdge[CDN · static seat maps]
    CDNEdge --> Queue

    subgraph WR ["Virtual waiting room — the key defence"]
        direction TB
        Queue["Signed queue token on arrival<br/>Redis sorted set · score = arrival ts"]
        Waiting["WAITING · 490,000<br/>position and ETA shown"]
        Admit["Admit at a CONTROLLED RATE<br/>e.g. 1,000/sec — matched to what<br/>the booking tier can actually handle"]
        Admitted["ADMITTED · 10,000<br/>token grants ~10 min access"]
        Queue --> Waiting --> Admit --> Admitted
    end

    Admitted --> GW[API Gateway<br/>no valid queue token, no entry]

    GW --> Browse

    Browse[("Browse path · Redis seat map<br/>TTL 2-5s · INTENTIONALLY STALE<br/>the map is a hint,<br/>truth is decided at hold time")]

    subgraph BOOK ["Booking path · contended"]
        direction TB
        Hold["1 · HOLD SEATS<br/>BEGIN TRANSACTION<br/>SELECT … FOR UPDATE<br/>WHERE state = AVAILABLE<br/>locks acquired in SORTED ORDER<br/>to avoid deadlock"]
        Verdict{"all available?"}
        Ok["UPDATE state = HELD<br/>set held_by and expires_at<br/>INSERT hold · COMMIT"]
        Conflict["ROLLBACK → 409<br/>suggest nearby alternatives"]
        Checkout["2 · CHECKOUT within 10 min · SAGA<br/>verify hold → charge → seats SOLD<br/>→ issue tickets<br/>compensate: refund + release"]
        Hold --> Verdict
        Verdict -- "yes" --> Ok --> Checkout
        Verdict -- "no" --> Conflict
    end

    GW --> Hold

    Checkout --> DB
    Ok --> DB
    DB[("Primary DB · Postgres<br/>ACID · CP<br/>SHARDED BY EVENT so one hot<br/>on-sale can't degrade the platform")]

    DB --> Sweeper["Hold expiry sweeper<br/>release where expires_at &lt; now()<br/>ALSO checked at read time —<br/>never rely on the sweeper alone"]
    DB --> SeatEvents{{"Kafka · seat.events<br/>→ cache invalidate<br/>→ live seat map over WS"}}
    SeatEvents -.-> Browse

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Browse,DB store
    class Queue,Hold hot""",

    "12-dropbox-file-sync": """flowchart TB
    subgraph CLIENT ["Client · desktop or mobile"]
        direction TB
        Watcher[Filesystem watcher]
        Chunker["CONTENT-DEFINED CHUNKER<br/>Rabin fingerprint, not fixed offsets<br/><br/>fixed-size: insert 1 byte → every<br/>boundary shifts → re-upload whole file<br/>content-defined: only the edited<br/>chunk changes → upload ~4 MB"]
        Hasher["SHA-256 each chunk"]
        LocalIdx[("Local index · path → chunks")]
        Watcher --> Chunker --> Hasher --> LocalIdx
    end

    Hasher -- "1 · POST /prepare with chunk hashes" --> Meta

    Meta["METADATA SERVICE<br/>which hashes do we already have?<br/>returns ONLY the missing ones<br/>← dedupe happens here<br/>authorization · quota · path validation"]

    Meta -- "2 · presigned URLs for missing chunks only" --> Blob
    Blob[("Object storage<br/>key = chunk_hash<br/>content-addressed: an identical<br/>chunk is stored ONCE globally<br/>refcounted, GC'd lazily")]

    Meta --> MetaDB[("Metadata DB · sharded by user_id<br/>files · versions · chunks · journal<br/>all of a user's data on one shard")]

    Meta -- "3 · commit ordered chunk list" --> Journal
    Journal["Append to user's JOURNAL<br/>seq++ · file_id · version"]
    Journal --> Notify

    Notify["Notification service<br/>long-poll or WS per device<br/>a POKE with no payload —<br/>a missed one is harmless"]

    Notify --> Devices
    Devices["Other devices<br/>GET /delta?cursor=last_seq<br/>diff against local index<br/>download ONLY missing chunks<br/>reassemble · advance cursor"]

    Conflict{"both edited offline?<br/>commit carries BASE VERSION"}
    Devices --> Conflict
    Conflict -- "base = current" --> Applied([applied])
    Conflict -- "base ≠ current" --> Keep["KEEP BOTH<br/>report.docx and<br/>'report (conflicted copy).docx'<br/>never silently discard work"]

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Blob,MetaDB,LocalIdx store
    class Chunker,Conflict hot""",

    "13-ad-click-aggregation": """flowchart TB
    Servers([Ad servers worldwide<br/>1M events/sec<br/>fire-and-forget: never blocks<br/>the ad response]) --> Ingest

    Ingest["Ingest gateway · regional, stateless<br/>validate · enrich geo and device<br/>attach RECEIVE time,<br/>KEEP the EVENT time"]
    Ingest --> Bus

    Bus{{"Kafka · ad.events<br/>partitioned by ad_id<br/>7-day retention"}}

    subgraph HOT ["Hot path · seconds"]
        direction TB
        Flink["Stream processor · Flink"]
        Dedup["1 · DEDUPE<br/>keyed state on event_id<br/>TTL = late window"]
        Window["2 · EVENT-TIME WINDOWING<br/>window by WHEN IT HAPPENED,<br/>not when it arrived<br/>tumbling 1-minute buckets"]
        Water["3 · WATERMARK<br/>= max_event_time − δ<br/>passes window end → EMIT<br/>late but in grace → EMIT UPDATE<br/>beyond grace → side output"]
        Agg["4 · aggregate + HyperLogLog sketches<br/>for mergeable unique counts"]
        Flink --> Dedup --> Window --> Water --> Agg
    end

    subgraph COLD ["Cold path · hours"]
        direction TB
        Archive[("Raw archive · object storage<br/>Parquet, partitioned by date/hour<br/>immutable, outlives Kafka retention")]
        Batch["Nightly reconciliation<br/>recompute yesterday from raw<br/>→ AUTHORITATIVE for billing"]
        Archive --> Batch
    end

    Bus --> Flink
    Bus --> Archive

    Agg -- "fast, approximate" --> OLAP
    Batch -- "slow, exact · OVERWRITES" --> OLAP

    OLAP[("OLAP store · Druid / ClickHouse<br/>columnar · pre-aggregated by minute<br/>rollups: minute → hour → day")]
    OLAP --> Query["Query service<br/>dashboards · reports · billing export<br/>recent windows cached in Redis"]

    Fraud["Fraud filter · parallel stream job<br/>repeat clicks · impossible CTR<br/>datacenter IPs · bot signatures<br/>FLAGS rather than deletes"] -.-> Batch
    Bus --> Fraud

    Water -. "checkpoints → exactly-once state;<br/>external writes still need<br/>idempotent upserts" .-> OLAP

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Archive,OLAP store
    class Window,Water hot""",

    "14-distributed-cache": """flowchart TB
    subgraph APP ["Application servers"]
        direction TB
        Client["SMART CLIENT library<br/>holds a copy of the ring<br/>hashes key → picks node → direct<br/>NO PROXY HOP = lowest latency<br/>optional tiny L1 for hot keys"]
    end

    Client -- "hash('user:1234')" --> Ring

    Ring{"CONSISTENT HASHING RING<br/>key belongs to the first node<br/>CLOCKWISE from its hash<br/><br/>hash % N → ~80% of keys remap<br/>on resize. CATASTROPHE.<br/>ring → only ~1/N remap,<br/>from ONE neighbour<br/><br/>VIRTUAL NODES: ~150 positions per<br/>physical node smooths distribution<br/>and allows weighting"}

    subgraph NODES ["Cache nodes"]
        direction LR
        N1["Node 1<br/>hash map → LRU list<br/>O(1) get and evict<br/>single-threaded:<br/>atomic ops, no locks,<br/>but one slow command<br/>blocks everything"]
        N2["Node 2"]
        N3["Node N"]
    end

    Ring --> N1
    Ring --> N2
    Ring --> N3

    N1 -. "async" .-> R1[("Replica 1")]
    N2 -. "async" .-> R2[("Replica 2")]
    N3 -. "async" .-> R3[("Replica N")]

    Gossip["Membership · gossip / SWIM<br/>suspicion → confirmation → dead<br/>avoid false positives: premature<br/>eviction causes a needless remap<br/>and an origin stampede"] -.-> NODES
    Gossip -.-> Client

    N1 -- "MISS" --> Origin
    Origin[("Origin database")]
    Origin -- "SET back into cache" --> N1

    Origin -.- Failures["Failure modes at the miss path:<br/>STAMPEDE · coalesce requests<br/>PENETRATION · cache negatives, Bloom filter<br/>AVALANCHE · TTL jitter, warm start,<br/>circuit breaker in front of origin"]

    HotKey["HOT KEYS are NOT solved by the ring.<br/>One key = one node by definition.<br/>Fix: client-side L1, key replication<br/>with suffix, or dedicated nodes."] -.-> Client

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class R1,R2,R3,Origin store
    class Ring,HotKey hot""",

    "15-google-docs-collaborative-editing": """flowchart TB
    subgraph CA ["Client A"]
        direction TB
        TypeA["User types"]
        LocalA["APPLY LOCALLY IMMEDIATELY · 0ms<br/>never wait for the server —<br/>typing must not feel laggy"]
        PendA[("Pending buffer<br/>unacked ops + base_version")]
        TypeA --> LocalA --> PendA
    end

    subgraph CB ["Client B"]
        direction TB
        LocalB["Apply locally<br/>transform incoming ops against<br/>own pending buffer"]
        PendB[("Pending buffer")]
        LocalB --> PendB
    end

    PendA -- "WebSocket" --> GW
    GW["WS Gateway · connection registry<br/>doc_id → connected clients"]
    GW --> Session

    subgraph SESS ["Document Session Server — ONE authoritative owner per document"]
        direction TB
        Session["routed by consistent hash on doc_id<br/>leader-elected so exactly one owns it"]
        Seq["1 · SEQUENCER<br/>assign a monotonic version<br/>concurrency is now defined relative<br/>to a single authoritative sequence"]
        Transform["2 · TRANSFORM (OT)<br/>both based on v5:<br/>A inserts at pos 3 → v6<br/>B inserts at pos 7, based on stale v5<br/>→ A's insert is BEFORE 7,<br/>so shift B: 7 → 8, apply as v7<br/><br/>without this the documents<br/>DIVERGE FOREVER"]
        Persist["3 · persist to append-only log"]
        Broadcast["4 · broadcast transformed op<br/>+ ack the originator"]
        Session --> Seq --> Transform --> Persist --> Broadcast
    end

    Broadcast --> GW
    GW --> LocalB

    Persist --> Ops[("operations · append-only<br/>PK = doc_id, SK = version<br/>the doc is a FOLD over ops")]
    Ops --> Snap["Snapshot job every N ops<br/>load = snapshot + ops since<br/>never replay a million entries"]
    Snap --> Blob[("Snapshots · object storage")]

    Presence[("Presence · Redis, ephemeral<br/>cursors and selections · TTL<br/>deliberately LOSSY: throttled,<br/>never persisted, never ordered")] -.-> GW

    Ops -. "owner dies → new owner elected,<br/>rebuilds from snapshot + ops,<br/>clients resend unacked ops" .-> Session

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Ops,Blob,Presence,PendA,PendB store
    class Transform,Seq hot""",
}
