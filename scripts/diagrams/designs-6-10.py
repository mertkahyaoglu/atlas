"""Mermaid architecture diagrams for designs 06-10."""

DIAGRAMS = {
    "06-search-typeahead": """flowchart TB
    subgraph ING ["Indexing path"]
        direction TB
        Truth[("Source of truth<br/>Postgres / Cassandra")]
        CDC{{"Kafka · document.changed<br/>via CDC"}}
        Pipe["Analysis pipeline<br/>tokenize → lowercase → stopwords<br/>→ stem → enrich"]
        Truth -- "CDC / Debezium" --> CDC --> Pipe
    end

    subgraph SHARDS ["Inverted index · document-partitioned, 3x replicated"]
        direction LR
        S0[("Shard 0")]
        S1[("Shard 1")]
        S2[("Shard N")]
    end

    Pipe -- "route by hash(doc_id)" --> S0
    Pipe --> S1
    Pipe --> S2

    Logs["Query logs → offline job<br/>rebuild trie with top-K<br/>completions per prefix"] --> Trie

    User([User typing]) -- "every keystroke<br/>debounced 50ms" --> Suggest
    User -- "on submit" --> Search

    Suggest["Suggest Service<br/>in-memory trie · ~5ms<br/>no disk, no ranking at query time"]
    Trie[("Trie · top-K per prefix")]
    Suggest --- Trie

    Search[Search Service] --> QCache[("Query cache · Redis<br/>normalized key · 60-80% hit")]
    QCache -- "miss" --> Parser["Query parser<br/>SAME analysis chain as indexing<br/>+ spell correction"]

    Parser -- "scatter" --> S0
    Parser -- "scatter" --> S1
    Parser -- "scatter" --> S2

    S0 -- "top 20 · BM25" --> Gather
    S1 -- "top 20 · BM25" --> Gather
    S2 -- "top 20 · BM25" --> Gather

    Gather["Merge and re-rank → global top 20<br/>latency bounded by SLOWEST shard<br/>hedged requests · timeout → partial results"]
    Gather --> Hydrate["Hydrate titles, snippets, facets"]
    Hydrate --> User

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Truth,S0,S1,S2,Trie,QCache store
    class Gather hot""",

    "07-uber-delivery-tracking": """flowchart TB
    Drivers([5M driver apps<br/>position every 4s]) --> LocGW[Location Gateway<br/>stateless · sharded by city]

    LocGW -- "HOT · synchronous" --> Geo
    LocGW -- "COLD · async" --> Stream

    Geo[("Redis geo index · per city<br/>GEOADD sorted set<br/>score = geohash<br/>OVERWRITE not append<br/>TTL 30s = liveness")]

    Stream{{"Kafka · location.stream"}} --> Flink["Flink / Spark streaming<br/>ETA models · analytics"]
    Flink --> Hist[("location_hist / S3")]

    Rider([Rider]) -- "POST /rides" --> RideSvc[Ride Service<br/>trip state = REQUESTED]
    subgraph M ["Matching Service"]
        direction TB
        Match["1 · GEOSEARCH radius 3km<br/>target cell + 8 NEIGHBOURS"]
        FilterD["2 · filter available, vehicle type,<br/>rating, heartbeat"]
        Rank["3 · rank by ROUTED ETA<br/>not straight-line distance"]
        Lock["4 · acquire per-driver lock<br/>SET NX PX 30s + fencing token<br/>prevents DOUBLE ASSIGNMENT"]
        Offer["5 · offer, wait 15s<br/>reject or timeout → next candidate"]
        Match --> FilterD --> Rank --> Lock --> Offer
    end

    RideSvc --> Match

    Geo --> Match
    Rank -.-> Routing[Routing / ETA Service]

    Offer -- "accepted" --> Trip
    Trip["Trip Service · state machine<br/>REQUESTED → MATCHED → ARRIVING<br/>→ IN_PROGRESS → COMPLETED"]
    Trip --> TripStore[("trips + trip_events<br/>Cassandra · audit")]
    Trip --> Saga["Saga on completion<br/>charge → pay driver → receipt<br/>compensations on failure"]

    LocGW -- "ONLY drivers on active trips<br/>throttled to 1 update / 2s" --> TripChan{{"pub/sub · trip:{id}"}}
    TripChan --> RiderWS([Rider live map])

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Geo,Hist,TripStore store
    class Lock hot""",

    "08-video-streaming": """flowchart TB
    Creator([Creator]) -- "1 · POST metadata only" --> UploadSvc[Upload Service]
    UploadSvc -- "2 · presigned multipart URL" --> Creator
    Creator -- "3 · uploads DIRECTLY<br/>bytes never touch app servers" --> Raw

    Raw[("Object storage · raw/<br/>multipart, chunked, resumable")]
    Raw -- "completion event" --> Bus{{"Kafka · video.uploaded"}}
    Bus --> Orch

    subgraph PIPE ["Transcoding pipeline · a DAG"]
        direction TB
        Orch[Orchestrator<br/>job DAG state machine]
        Inspect["1 · inspect codec, duration, tracks"]
        Split["2 · split into ~10s chunks<br/>on KEYFRAME boundaries<br/>this is what makes it parallel"]
        Transcode["3 · transcode each chunk × each rendition<br/>240p…4K · H.264 + AV1<br/>on spot instances: batch, idempotent, retryable"]
        Side["4 · parallel side jobs<br/>thumbnails · audio · captions · moderation"]
        Package["5 · package HLS / DASH segments<br/>+ master manifest"]
        Orch --> Inspect --> Split --> Transcode --> Side --> Package
    end

    Package --> Processed[("Object storage · processed/<br/>status = READY")]
    Processed --> Origin[Origin<br/>serves CDN misses only]

    subgraph CDN ["CDN edges · over 95% of all bytes"]
        direction LR
        Edge1[London]
        Edge2[Tokyo]
        Edge3[São Paulo]
    end

    Origin -- "pull on miss · under 5%" --> Edge1
    Origin --> Edge2
    Origin --> Edge3

    Edge1 --> Player
    Edge2 --> Player
    Edge3 --> Player

    Player["Player · adaptive bitrate<br/>measures throughput + buffer<br/>steps DOWN aggressively,<br/>UP conservatively"]
    Player -. "view events · async" .-> Views{{"Kafka → Flink<br/>view counts, watch time, QoE"}}

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Raw,Processed store
    class Split hot""",

    "09-web-crawler": """flowchart TB
    Seeds([Seed URLs]) --> Front

    subgraph FRONTIER ["URL Frontier"]
        direction TB
        Front["Front queues · PRIORITY<br/>Q1 high: news, homepages<br/>Q2 medium · Q3 low<br/>weighted selector"]
        Back["Back queues · POLITENESS<br/>ONE QUEUE PER HOST<br/>heap keyed by next_allowed_fetch_time<br/>a worker can only pop a URL<br/>whose host is ready"]
        Front --> Back
    end

    subgraph FETCH ["Fetcher fleet"]
        direction LR
        F1[Fetcher 1]
        F2[Fetcher 2]
        F3[Fetcher N]
    end

    Back -- "consistent hashing by DOMAIN<br/>all URLs for a host → one node" --> F1
    Back --> F2
    Back --> F3

    Robots[("robots.txt cache · 24h<br/>allow/deny + crawl-delay")] -.-> F1
    DNS[("DNS cache<br/>a hidden bottleneck:<br/>resolution is slow and synchronous")] -.-> F1

    F1 --> HTTP["HTTP fetch<br/>timeout · max size · redirect limit<br/>ETag / If-Modified-Since → 304 is free"]
    F2 --> HTTP
    F3 --> HTTP

    HTTP --> Dedupe["Content dedupe<br/>checksum → exact duplicate<br/>simhash → NEAR duplicate<br/>mirrors, boilerplate, session ids"]
    Dedupe --> PageStore[("Page store<br/>compressed HTML in object storage")]
    Dedupe --> Parser

    Parser["Parser / link extractor<br/>URL normalization:<br/>lowercase host · strip fragment<br/>sort query params · resolve relative"]
    Parser --> Bloom

    Bloom{"URL seen? · BLOOM FILTER<br/>100B URLs at 10 bits ≈ 125 GB<br/>no false negatives · ~1% false positives"}
    Bloom -- "definitely not seen" --> Front
    Bloom -- "probably seen · skip" --> Drop([discard])

    Traps["Trap detection<br/>max depth · per-domain cap<br/>calendar and session-id patterns"] -.-> Front
    Recrawl["Recrawl scheduler<br/>estimate change frequency<br/>→ next_crawl_at"] -.-> Front

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Robots,DNS,PageStore store
    class Bloom,Back hot""",

    "10-payment-system": """flowchart TB
    Checkout([Checkout]) -. "card details go DIRECTLY to PSP<br/>your servers NEVER see a PAN" .-> PSP
    Checkout -- "POST /payments<br/>Idempotency-Key" --> GW[API Gateway]
    subgraph PAY ["Payment Service"]
        direction TB
        Idem{"1 · IDEMPOTENCY CHECK<br/>INSERT on (merchant, key)<br/>unique constraint IS the lock"}
        Found["key found + completed<br/>→ return STORED response<br/>do NOT re-execute"]
        Txn["2 · SINGLE ACID TRANSACTION<br/>INSERT payment (PENDING)<br/>INSERT balanced ledger entries<br/>INSERT outbox row<br/>COMMIT — all or nothing"]
        Idem -- "seen" --> Found
        Idem -- "new · claimed" --> Txn
    end

    GW --> Idem

    Txn --> DB[("Primary DB · Postgres<br/>ACID · CP · synchronous replication<br/>ledger is APPEND-ONLY<br/>Σ debits = Σ credits")]
    Txn --> Outbox

    Outbox["Outbox publisher<br/>polls unpublished rows → Kafka<br/>solves the DUAL WRITE problem"]
    Outbox --> Events{{"Kafka · payment.events"}}

    Events --> Worker
    Events --> Downstream["Downstream consumers<br/>fulfilment · receipts · warehouse"]

    Worker["PSP worker · authorize / capture<br/>timeout + backoff + jitter<br/>circuit breaker per PSP<br/>passes OUR idempotency key to the PSP"]
    Worker --> PSP[("PSP · Stripe / Adyen / bank")]

    Worker -. "TIMEOUT = UNKNOWN STATE,<br/>not failure. Resolve by QUERYING<br/>the PSP for the key." .-> Worker

    PSP --> Hook["Webhook receiver<br/>verify HMAC signature<br/>dedupe on psp_event_id<br/>tolerate out-of-order arrival"]
    Hook --> DB

    DB --> Recon["Daily reconciliation<br/>PSP settlement file ⟷ our ledger<br/>discrepancies → exceptions queue<br/>this is NOT optional"]

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB,PSP store
    class Idem hot""",
}
