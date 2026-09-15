---
group: "design"
order: 7
title: "Uber / Delivery Tracking"
summary: "Five million drivers publishing position every four seconds, matched to riders in real time."
hardPart: "Two problems glued together: 1.25M location writes per second that destroy any disk-backed index, and a matching step where two riders must never get the same driver."
tags: ["geospatial", "redis", "concurrency", "realtime", "saga"]
hardPartDetail: "Two distinct problems glued together. (1) Millions of drivers writing location every 4 seconds destroys any disk-backed index. (2) Matching is a contention problem — two riders must not be assigned the same driver. Candidates who only solve the geospatial half miss the harder half."
concepts:
  - "geospatial indexing (geohash/S2/quadtree)"
  - "high-frequency location writes"
  - "in-memory state"
  - "matching under contention"
  - "WebSockets for live tracking"
  - "stream processing"
  - "distributed locking"
  - "sagas"
requirements:
  functional:
    - "Drivers publish location continuously"
    - "Rider requests a ride from A to B"
    - "System finds nearby available drivers and offers the trip"
    - "Driver accepts; rider sees live driver position until pickup and dropoff"
    - "Trip lifecycle: requested → matched → en route → in progress → completed → paid"
  nonFunctional:
    - "Match within a few seconds"
    - "Location freshness ~5 seconds (stale-but-recent is fine)"
    - "Never double-assign a driver (strong consistency at the assignment point only)"
    - "High availability; a region outage must not take down other regions"
  outOfScope:
    - "Pricing/surge algorithms"
    - "Routing/ETA computation internals (treat as a service)"
    - "Fraud"
scale:
  numbers: |-
    Drivers online:     5M
    Location updates:   every 4s → 5M/4 = 1.25M writes/sec   ← the headline number
    Ride requests:      10,000/sec
    Location payload:   ~100B → 125 MB/sec sustained
  conclusion: "1.25M writes/sec of ephemeral data that is worthless after 10 seconds. That single fact dictates an in-memory store for current position, with history written asynchronously to a separate cold path. Anyone proposing a disk-backed geospatial index here has missed the point."
tradeoffs:
  - title: "Why geohash, and the boundary trap"
    body: |-
      Geohash encodes lat/lng into a string where nearby points share a prefix, turning a 2D proximity query into a 1D prefix scan any index can serve. The trap: two points can be 10 metres apart but sit either side of a cell boundary and share no prefix. **Always query the target cell plus its 8 neighbours**, then filter by true distance. Forgetting this produces a system that mysteriously can't find the driver parked across the street.
  - title: "Geohash vs quadtree vs S2"
    body: |-
      - *Geohash*: dead simple, works with any string-prefix index, fixed grid so dense cities and empty ocean get the same treatment.
      - *Quadtree*: subdivides only where density is high, adapting to uneven distribution. Better for wildly varying density, more complex to maintain under constant updates.
      - *S2*: projects the sphere onto a cube with a Hilbert curve; better locality, handles poles and the antimeridian correctly. What Uber and Google actually use.

      For an interview, geohash with an explicit mention of S2 and the density caveat is a complete answer.
  - title: "Why Redis and not a database"
    body: |-
      These writes are overwrites of ephemeral state with a useful lifetime of seconds. Durability is not required — if Redis loses a position, the driver publishes a new one four seconds later. Writing 1.25M/sec to a disk-backed store to hold data you'll throw away is the wrong trade. Persist to Kafka asynchronously for analytics, and keep the two paths separate.
  - title: "Cells are the natural shard key"
    body: |-
      Partition Redis by city or region. All matching queries are local to a region, so no cross-shard scatter-gather. This also gives you regional fault isolation for free: San Francisco going down doesn't touch London. Say this explicitly — it's a strong availability argument.
  - title: "The matching contention problem"
    body: |-
      This is the part most candidates miss. Two rider requests in the same neighbourhood will surface overlapping candidate lists. Without a mutex, both get offered the same driver. Use a short-TTL distributed lock (`SET lock:driver:{id} {token} NX PX 30000`) around the offer window, release it on accept-elsewhere, reject, or timeout. The TTL is the safety net so a crashed matcher doesn't strand a driver forever.

      Be ready for the honest caveat: Redis locks are not a correctness guarantee under pause-and-resume scenarios (a matcher can be GC-paused past its TTL while believing it holds the lock). The fix is a **fencing token** — a monotonically increasing number issued with the lock that the trip service checks, rejecting any assignment carrying a stale token. Alternatively, make the final assignment a conditional write on the trip row (`UPDATE ... WHERE driver_id IS NULL`), so the database is the arbiter of record. That conditional write is the simplest correct answer and worth offering.
  - title: "Consistency, scoped narrowly"
    body: |-
      Almost everything here is AP — driver positions, ETAs, nearby-driver lists can all be a few seconds stale with no harm. Exactly one operation needs strong consistency: the driver assignment. Isolating strong consistency to a single narrow operation, instead of applying it system-wide, is the mature design instinct.
  - title: "Straight-line distance is not ETA"
    body: |-
      A driver 500m away across a river is 15 minutes away. Rank candidates by routed ETA from a routing service, not by geohash distance. Use geo distance only to generate the candidate set cheaply, then rank properly on a small set. That two-stage pattern (cheap retrieval, expensive ranking) is the same shape as search.
  - title: "Live tracking must be filtered"
    body: |-
      Publishing all 5M drivers' positions to a pub/sub layer would be catastrophic. Only drivers on an active trip publish to a `trip:{id}` channel, and only the one rider subscribes. Throttle to ~1 update per 2 seconds; the map interpolates between points for smoothness. This turns an impossible fan-out into a fan-out of 1.
  - title: "Trip completion is a saga"
    body: |-
      Charging the rider, paying the driver, and issuing a receipt span multiple services. Use a saga with compensating actions (refund on payout failure) rather than a distributed transaction, and make each step idempotent.
  - title: "Driver liveness"
    body: |-
      A TTL on the Redis entry means a driver whose app crashed silently disappears from the index within 30 seconds. No cleanup job, no stale offers to phones that aren't listening. TTL-as-liveness is an elegant detail worth calling out.
followUps:
  - question: "Surge pricing?"
    answer: "A stream job computes supply/demand ratio per cell over a sliding window, writes a multiplier per cell to Redis, and the pricing service reads it at quote time. Note that pricing must be locked at quote time, not recomputed at charge time."
  - question: "What if no drivers are within 3km?"
    answer: "Expand the radius progressively (3 → 5 → 10km), then queue the request and retry as drivers become available, with an honest wait estimate to the rider."
  - question: "Driver accepts but then cancels?"
    answer: "Return the trip to the matching pool, release the lock, penalize acceptance-rate metrics, and re-run matching excluding that driver."
  - question: "Batched matching instead of greedy?"
    answer: "Greedy first-come matching is locally optimal but globally worse. Collecting requests over a few-second window and solving a bipartite assignment (Hungarian algorithm) produces better global outcomes at the cost of added latency. Uber does a version of this — a strong thing to raise unprompted."
  - question: "How do you handle a whole region's Redis failing?"
    answer: "Drivers re-publish within 4 seconds, so the index self-heals almost immediately. That's a nice property of ephemeral state: recovery is automatic. In-flight trips are unaffected because they live in Cassandra."
  - question: "Food delivery differences?"
    answer: "One courier serves multiple orders (batching), and there's a third party (the restaurant) with its own state machine and prep-time estimates. The geospatial and matching cores are identical."
---
# 07 — Uber / Delivery Tracking (Proximity + Matching)

## API / Model

```api
# Driver · persistent WS or frequent POST
POST /v1/drivers/location || {driver_id, lat, lng, heading, ts} || 202
WS driver stream || || 101 || receives trip offers
# Rider
POST /v1/rides || {pickup, dropoff} || 201 ride_id
GET /v1/rides/{id} || || 200 status
WS rider stream || || 101 || receives driver position updates
```

```schema
# Redis · hot, in-memory, current state only
geo:{city_id} || || GEOADD sorted set, geohash score || driver positions
driver:{id}:status || || available | offered | on_trip || kept alive by a TTL heartbeat
lock:driver:{id} || || SET NX PX || assignment mutex
# Cassandra · persistent
trips || PK: trip_id || rider, driver, state, timestamps, fare ||
trip_events || PK: trip_id SK: ts || state transitions || audit trail
location_hist || PK: (driver_id, day) SK: ts || positions || cold path, analytics only
```

---

## High-level architecture

<!-- tab: Today · 1.25M pings/s -->

```mermaid
flowchart TB
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

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class TripStore db
    class Geo cache
    class Hist blob
    class Lock hot
    class Stream,TripChan queue

    click Geo href "/docs/04-caching" "Role: live driver positions for nearby-driver search, overwritten on every ping.<br/>Trade-off: in memory and lossy, so history has to live somewhere else."
    click Stream href "/docs/05-async-messaging-and-event-driven" "Role: the cold path that carries every location ping for analytics.<br/>Trade-off: huge volume and storage cost for data the matching path never needs."
    click Flink href "/docs/09-specialized-building-blocks" "Role: turns raw pings into ETA models and analytics.<br/>Trade-off: results lag real time, so it never sits on the matching path."
    click Hist href "/docs/09-specialized-building-blocks" "Role: cheap long-term location history, partitioned for analytics.<br/>Trade-off: slow to query and useless for live features."
    click TripStore href "/docs/02-data-storage" "Role: durable trip records plus every state change, for audit.<br/>Trade-off: write-optimized, so ad-hoc reporting needs another system."
    click TripChan href "/docs/05-async-messaging-and-event-driven" "Role: streams the driver's position to the rider during a trip.<br/>Trade-off: dropped updates are acceptable because the next ping replaces them."
```

Two workloads meet in this design: a constant stream of driver positions through the Location Gateway, and rider requests that go through matching and become trips. The Redis geo index is where they connect.

1. A rider's `POST /rides` creates a trip in the Ride Service with state `REQUESTED` and hands it to the Matching Service, which runs GEOSEARCH on the Redis geo index within 3 km, covering the target cell and its 8 neighbours.
2. It filters candidates by availability, vehicle type, rating and heartbeat.
3. It ranks the rest by routed ETA from the Routing / ETA Service rather than by straight-line distance.
4. It acquires a per-driver lock with `SET NX PX` and a 30-second expiry, plus a fencing token, so the driver can't be assigned twice.
5. It offers the trip and waits 15 seconds. A reject or timeout moves it to the next candidate.
6. Once a driver accepts, the Trip Service runs the state machine from `MATCHED` through `ARRIVING` and `IN_PROGRESS` to `COMPLETED`, records each change in `trips` and `trip_events`, and starts the saga on completion: charge, pay the driver, send the receipt.

The geo index is fed by the location paths. Every 4 seconds a driver's position reaches the Location Gateway, which overwrites that driver's entry synchronously, with a 30-second TTL that doubles as liveness, and sends the ping asynchronously to Kafka `location.stream`. Flink / Spark streaming turns that stream into ETA models and analytics and writes history to `location_hist` in S3. For drivers on an active trip only, the gateway also publishes to `trip:{id}`, throttled to one update every 2 seconds, which the rider's live map subscribes to.

<!-- tab: At 10x · 12.5M pings/s -->

```mermaid
flowchart TB
    Drivers([50M driver apps]) -- "persistent connection<br/>2s moving · 15s idle" --> Ingest["Location ingest · per region<br/>one socket per driver<br/>pings in, offers out"]
    Ingest -- "route by S2 cell" --> CellRouter["Cell router<br/>S2 cell → geo shard<br/>splits cells that get too dense"]
    CellRouter -- "HOT · synchronous" --> Geo[("Geo shards · per S2 cell<br/>a big metro spans many shards<br/>overwrite · TTL 30s = liveness")]
    Ingest -- "COLD · async" --> Stream{{"Kafka · location.stream"}}
    Stream --> Down["Downsampler<br/>on-trip pings at full rate<br/>idle drivers ~1 per minute"]
    Down --> Hist[("location_hist · columnar<br/>object storage")]

    Rider([Rider]) -- "POST /rides" --> RideSvc[Ride Service<br/>trip state = REQUESTED]
    RideSvc --> Batch

    subgraph M ["Matching · one matcher per cell"]
        direction TB
        Batch["1 · collect the cell's requests<br/>for ~2 seconds"]
        Cand["2 · candidates from cell + 8 neighbours<br/>may span several geo shards"]
        Solve["3 · bipartite assignment<br/>for the whole batch at once"]
        Border["4 · lock only drivers also wanted<br/>by a neighbouring cell's batch"]
        Batch --> Cand --> Solve --> Border
    end
    Geo --> Cand
    Solve -.-> Routing[Routing / ETA Service]

    Border -- "offer · conditional write<br/>WHERE driver_id IS NULL" --> Trip["Trip Service · state machine"]
    Trip --> TripStore[("trips + trip_events · Cassandra<br/>each city pinned to a region")]
    Trip --> Saga["Saga on completion<br/>charge → pay driver → receipt"]
    Ingest -- "on-trip drivers only<br/>throttled to 1 / 2s" --> TripChan{{"pub/sub · trip:{id}"}}
    TripChan --> RiderWS([Rider live map])

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class TripStore db
    class Geo cache
    class Hist blob
    class Stream,TripChan queue
    class Solve hot
    class Ingest,CellRouter,Geo,Down,Hist,Batch,Cand,Solve,Border scaled

    click Ingest href "/docs/07-apis-and-communication" "Role: holds a persistent connection per driver, carrying pings in and offers out.<br/>Trade-off: stateful, so a node failure reconnects hundreds of thousands of drivers."
    click CellRouter href "/docs/09-specialized-building-blocks" "Role: maps S2 cells to geo shards and splits cells that get too dense.<br/>Trade-off: a nearby-driver search can now span several shards."
    click Geo href "/docs/04-caching" "Role: live positions per S2 cell, overwritten on every ping, with TTL as liveness.<br/>Trade-off: in memory and lossy, as today, just split more finely."
    click Down href "/docs/09-specialized-building-blocks" "Role: keeps on-trip pings at full rate and thins idle ones to about one a minute.<br/>Trade-off: idle-driver history is too coarse for some analyses."
    click Hist href "/docs/09-specialized-building-blocks" "Role: columnar location history in object storage.<br/>Trade-off: cheap and slow, for analytics only."
    click Batch href "/docs/03-consistency-and-distributed-systems" "Role: collects a cell's ride requests for about two seconds before matching.<br/>Trade-off: adds up to ~2s before a match is attempted."
    click Solve href "/docs/09-specialized-building-blocks" "Role: assigns drivers to the whole batch of riders at once.<br/>Trade-off: more compute per round, repaid by better global matches."
    click Border href "/docs/03-consistency-and-distributed-systems" "Role: locks only drivers that a neighbouring cell's batch also wants.<br/>Trade-off: border drivers can still collide, which costs a retry, never a double assignment."
    click TripStore href "/docs/02-data-storage" "Role: durable trips and every state change, with each city pinned to a region.<br/>Trade-off: a trip that crosses a region border stays owned by where it started."
```

Same product at 10x. At 100x there would be 500M drivers online, more than the world's taxi and courier workforce, so 10x (rides, food and parcels on one platform) is the realistic tier. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Drivers online | 5M | 50M |
| Location pings at a flat 4s | 1.25M/sec | 12.5M/sec |
| Ride requests | 10k/sec | 100k/sec |
| Raw location payload | 125 MB/sec | 1.25 GB/sec |
| Drivers in the densest metro | tens of thousands | hundreds of thousands |

**What changes, and the number that forces it**

1. **Ping rate adapts to what the driver is doing.** At a flat 4-second interval, most of 12.5M writes/sec would come from parked drivers. Drivers on a trip or heading to a pickup ping every 2 seconds, idle and stationary drivers every 15, and the app sends immediately after a large position change. Most online drivers are idle at any moment, so this removes a large share of the writes without making any match worse.
2. **Persistent connections replace a POST per ping.** At this rate, per-request overhead (TLS, headers, load-balancer work) costs more than the 100-byte payload. Drivers hold one connection to regional ingest, which also pushes trip offers back down the same socket.
3. **City shards split into S2 cells.** The densest metros now have hundreds of thousands of drivers online, more writes than one Redis sorted set on one node can take. A cell router maps S2 cells to geo shards and splits a cell when it gets too dense, so a search over a cell and its neighbours may touch a few shards. Regional fault isolation still holds, because cells never span regions.
4. **Matching goes batched, one matcher per cell.** At 100k ride requests/sec, overlapping candidate lists become the norm and most lock attempts collide. Each cell's matcher collects requests for ~2 seconds and solves the batch as one bipartite assignment, the approach from the batched-matching follow-up. That gives better global matches and removes contention inside the cell, since one matcher owns it. Locks are only needed for drivers a neighbouring cell's batch also wants. The cost is up to ~2 seconds added to time-to-match.
5. **The conditional write is still the arbiter.** `WHERE driver_id IS NULL` on the trip row stays the final word, so a race at a cell border costs a retry and never a double assignment.
6. **Location history is downsampled.** 1.25 GB/sec of raw pings mostly records cars that aren't moving. On-trip pings are kept at full rate for fares, disputes and ETA training; idle pings are thinned to about one per minute before landing in columnar files in object storage.

**What stays the same**

Current position lives in memory and is overwritten, never appended, with TTL as liveness. Candidates are still ranked by routed ETA rather than straight-line distance, only on-trip drivers publish live position to `trip:{id}`, and trip completion is still a saga with compensations.

<!-- /tabs -->

---
