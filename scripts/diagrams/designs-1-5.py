"""Mermaid architecture diagrams for designs 01-05."""

DIAGRAMS = {
    "01-twitter-instagram-feed": """flowchart TB
    Client([Mobile / Web client])
    GW[API Gateway<br/>auth · rate limit]
    Client --> GW

    subgraph WRITE ["Write path"]
        direction TB
        PostSvc[Post Service]
        PostStore[(posts store<br/>Cassandra)]
        Bus{{"Kafka · post.created"}}
        PostSvc --> PostStore
        PostSvc --> Bus
    end

    subgraph FANOUT ["Fan-out service · consumer group"]
        direction TB
        Decide{"author follower count<br/>&gt; 100k ?"}
        Eager["Fan out to followers<br/>batched idempotent writes<br/>PK = user_id + post_id"]
        Skip["Skip eager fan-out<br/>mark for read-time pull"]
        Decide -- "no · ordinary user" --> Eager
        Decide -- "yes · celebrity" --> Skip
    end

    subgraph READ ["Read path"]
        direction TB
        Timeline[Timeline Service]
        Merge["Merge and sort by post_id<br/>filter deleted · paginate by cursor"]
        Timeline --> Merge
    end

    Feed[("user_timeline<br/>PK = user_id<br/>SK = post_id DESC")]
    CelebCache[("Redis · celebrity cache<br/>one list serves 100M followers")]
    TimelineCache[("Redis · assembled timeline<br/>TTL 30s")]
    Media[("Blob storage + CDN<br/>images and video")]

    GW --> PostSvc
    GW --> Timeline
    Bus --> Decide
    Eager --> Feed
    Skip --> CelebCache

    Feed -- "precomputed rows" --> Merge
    CelebCache -- "celebrity posts" --> Merge
    Merge --> TimelineCache
    TimelineCache --> Client
    Media -.-> Client

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PostStore,Feed,CelebCache,TimelineCache,Media store
    class Decide hot""",

    "02-chat-slack": """flowchart TB
    A([Client A]) -- "WSS" --> GWA["WS Gateway #17<br/>holds A's socket"]
    GWB["WS Gateway #42<br/>holds B's socket"] -- "WSS" --> B([Client B])

    subgraph CHAT ["Chat Service"]
        direction TB
        Chat["Validate and authorize<br/>assign Snowflake message_id<br/>dedupe on client_msg_id"]
        Durable[("messages store · Cassandra<br/>PK = conversation_id<br/>SK = message_id DESC")]
        Chat -- "1 · durable write FIRST" --> Durable
        Durable -- "2 · only now ack sender" --> Chat
    end

    GWA --> Chat

    Chat -- "3 · resolve recipient" --> Registry
    Registry[("Connection registry · Redis<br/>user_id → gateway node<br/>TTL + heartbeat")]
    Registry --> Online{"recipient online?"}

    Online -- "yes" --> PubSub{{"Pub/sub · channel gw:42"}}
    PubSub --> GWB

    Online -- "no" --> Inbox[("inbox_queue<br/>undelivered rows")]
    Inbox --> Push["APNs / FCM<br/>mobile push"]

    Inbox -. "on reconnect: drain backlog,<br/>client acks, rows deleted" .-> GWB

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Durable,Registry,Inbox store
    class Online hot""",

    "03-url-shortener": """flowchart TB
    Cache[("Redis cluster<br/>code → long_url<br/>LRU + TTL")]

    subgraph W ["Write path · 1k/sec"]
        direction TB
        Creator([Client]) --> WGW[API Gateway<br/>auth · abuse rate limit]
        WGW --> Shorten[Shorten Service]
        Shorten --> IDGen["ID generation<br/>ticket server hands out<br/>ranges of 10,000<br/>then base62 of scrambled counter"]
        IDGen --> Store[("urls store<br/>PK = short_code<br/>conditional write")]
        Store -- "write-through" --> Cache
    end

    subgraph R ["Read path · 100k/sec"]
        direction TB
        Browser([Browser]) --> LB[Load balancer]
        LB --> Redirect[Redirect Service<br/>stateless · autoscaled]
        Redirect --> Cache
        Cache -- "~95% HIT" --> Resp["302 Found"]
        Cache -- "~5% MISS" --> Replica[("urls store<br/>read replicas")]
        Replica -- "populate" --> Cache
        Resp --> Browser
    end

    Resp -. "fire and forget<br/>never blocks the redirect" .-> Clicks{{"Kafka · click events"}}
    Clicks --> Flink["Stream processor<br/>tumbling windows"]
    Flink --> Agg[("clicks_agg<br/>fast stats")]
    Flink --> Warehouse[("Data warehouse<br/>raw analytics")]

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    class Store,Cache,Replica,Agg,Warehouse store""",

    "04-rate-limiter": """flowchart TB
    Clients([Clients]) --> Scrub["CDN · L3/L4 scrubbing<br/>volumetric attacks die here"]
    Scrub --> LB[Load balancer]

    subgraph GATEWAYS ["API gateway fleet"]
        direction LR
        G1["Gateway 1<br/>L1 local bucket"]
        G2["Gateway 2<br/>L1 local bucket"]
        G3["Gateway N<br/>L1 local bucket"]
    end

    LB --> G1
    LB --> G2
    LB --> G3

    G1 -- "L2 · batched sync" --> Redis
    G2 -- "L2 · batched sync" --> Redis
    G3 -- "L2 · batched sync" --> Redis

    Redis[("Redis cluster · sharded by identity<br/>Lua script = atomic<br/>check-and-decrement<br/>one round trip, no race")]

    Redis --> Verdict{"tokens available?"}
    Verdict -- "allow" --> Backend[Backend services]
    Verdict -- "deny" --> Reject["429 Too Many Requests<br/>Retry-After · X-RateLimit-*"]

    Config[("Config service · rules<br/>cached locally<br/>safe defaults on failure")] -.-> G1
    Config -.-> G2
    Config -.-> G3

    Redis -. "unreachable → FAIL OPEN<br/>on local bucket only,<br/>log and alert" .-> Backend

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Redis,Config store
    class Verdict hot""",

    "05-notification-system": """flowchart TB
    subgraph P ["Producers"]
        direction LR
        PR[PR Service]
        CI[CI Service]
        CM[Comments]
        IS[Issues]
    end

    PR --> Bus
    CI --> Bus
    CM --> Bus
    IS --> Bus

    Bus{{"Kafka · activity.events<br/>partitioned by entity_id<br/>7-day retention = replayable"}}

    subgraph FO ["Fan-out service"]
        direction TB
        Audience["1 · resolve audience<br/>watchers + mentions + participants"]
        Celeb{"2 · celebrity repo?<br/>&gt; 100k watchers"}
        Filter["3 · filter muted and prefs"]
        Collapse["4 · collapse duplicates<br/>'10 people liked your post'"]
        Write["5 · batched idempotent write<br/>PK = user_id + event_id"]
        Audience --> Celeb
        Celeb -- "no" --> Filter --> Collapse --> Write
        Celeb -- "yes · pull at read time" --> ReadPull[Mark for read-time merge]
    end

    Bus --> Audience
    Write --> Store[("notifications store<br/>Cassandra · PK = user_id")]
    Write --> Jobs{{"Kafka · delivery.jobs<br/>one job per channel"}}

    subgraph D ["Delivery workers · bulkheaded per provider"]
        direction LR
        InApp["In-app worker"]
        PushW["Push worker<br/>quiet hours check"]
        EmailW["Email worker<br/>digest buffering"]
    end

    Jobs --> InApp
    Jobs --> PushW
    Jobs --> EmailW

    InApp --> WS["Redis pub/sub → WS gateway"]
    PushW --> APNs["APNs / FCM"]
    EmailW --> SMTP["SMTP provider"]

    APNs --> Retry
    SMTP --> Retry
    Retry["Retry · exponential backoff + jitter<br/>circuit breaker per provider"]
    Retry -- "attempts exhausted" --> DLQ[("Dead letter queue<br/>ALERT on depth · replay after fix")]

    Store --> ReadAPI["Read API<br/>cursor paginated"]
    ReadPull -.-> ReadAPI
    Counters[("Redis · unread counters<br/>atomic INCR/DECR<br/>periodically reconciled")] --> ReadAPI

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Store,DLQ,Counters store
    class Celeb hot""",
}
