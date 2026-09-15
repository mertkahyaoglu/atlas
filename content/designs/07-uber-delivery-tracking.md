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
  outOfScope: "pricing/surge algorithms, routing/ETA computation internals (treat as a service), fraud."
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

    classDef store fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Geo,Hist,TripStore store
    class Lock hot
    class Stream,TripChan queue

    click Geo href "/docs/04-caching" "Role: live driver positions for nearby-driver search, overwritten on every ping.<br/>Trade-off: in memory and lossy, so history has to live somewhere else."
    click Stream href "/docs/05-async-messaging-and-event-driven" "Role: the cold path that carries every location ping for analytics.<br/>Trade-off: huge volume and storage cost for data the matching path never needs."
    click Flink href "/docs/09-specialized-building-blocks" "Role: turns raw pings into ETA models and analytics.<br/>Trade-off: results lag real time, so it never sits on the matching path."
    click Hist href "/docs/09-specialized-building-blocks" "Role: cheap long-term location history, partitioned for analytics.<br/>Trade-off: slow to query and useless for live features."
    click TripStore href "/docs/02-data-storage" "Role: durable trip records plus every state change, for audit.<br/>Trade-off: write-optimized, so ad-hoc reporting needs another system."
    click TripChan href "/docs/05-async-messaging-and-event-driven" "Role: streams the driver's position to the rider during a trip.<br/>Trade-off: dropped updates are acceptable because the next ping replaces them."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
 ═══════════ LOCATION INGEST (1.25M writes/sec) ═══════════

  [Driver apps] ──WS/HTTP──► ┌──────────────────────┐
     5M devices              │  LOCATION GATEWAY     │ stateless, autoscaled
     every 4s                │  validate, rate limit │ sharded by city
                              └──────────┬───────────┘
                                          │
                  ┌───────────────────────┴────────────────────┐
                  │ HOT PATH (synchronous)   COLD PATH (async)  │
                  ▼                                     ▼
      ┌────────────────────────────┐        ┌────────────────────────┐
      │  REDIS GEO INDEX            │        │ Kafka: location.stream │
      │  per-city sorted set         │        └───────────┬────────────┘
      │  GEOADD geo:sf driver_123    │                    ▼
      │  score = geohash(lat,lng)    │        ┌────────────────────────┐
      │                              │        │ Flink / Spark Streaming │
      │  ⚠ overwrite, not append —   │        │  → trip replay, ETA     │
      │    old positions worthless   │        │    models, analytics    │
      │  TTL 30s → dead drivers      │        └───────────┬────────────┘
      │    self-evict                │                    ▼
      └──────────┬─────────────────┘        ┌────────────────────────┐
                 │                            │ location_hist / S3     │
                 │                            └────────────────────────┘
                 │
 ═══════════════ MATCHING ═══════════════
                 │
  [Rider] ──POST /rides──► ┌──────────────────────┐
                            │   RIDE SERVICE        │
                            │   create trip (state= │
                            │   REQUESTED)          │
                            └──────────┬───────────┘
                                        ▼
                     ┌──────────────────────────────────────┐
                     │        MATCHING SERVICE               │
                     │                                       │
                     │ 1. GEOSEARCH geo:sf BYRADIUS 3km      │
                     │      → candidate drivers (geohash     │
                     │        prefix + 8 NEIGHBOR cells)     │
                     │                                       │
                     │ 2. filter: status==available,         │
                     │      vehicle type, rating, heartbeat  │
                     │                                       │
                     │ 3. rank: real ETA (not straight-line) │
                     │      ──► [Routing / ETA Service]      │
                     │                                       │
                     │ 4. ┌──────────────────────────────┐   │
                     │    │ ACQUIRE LOCK per driver       │   │
                     │    │ SET lock:driver:123 NX PX 30s │   │
                     │    │ ← prevents DOUBLE ASSIGNMENT  │   │
                     │    └──────────────────────────────┘   │
                     │ 5. offer → wait for accept (15s)      │
                     │    reject/timeout → release lock,     │
                     │    try next candidate                 │
                     └──────────────┬───────────────────────┘
                                     │ accepted
                                     ▼
                     ┌──────────────────────────────────────┐
                     │  TRIP SERVICE  (state machine)        │
                     │  REQUESTED→MATCHED→ARRIVING→          │
                     │  IN_PROGRESS→COMPLETED                │
                     │  each transition → trip_events (audit)│
                     └───────┬──────────────────────┬───────┘
                             │                       │
                             ▼                       ▼
                ┌─────────────────────┐   ┌────────────────────────┐
                │ Kafka: trip.events  │   │  SAGA on completion:    │
                │  → notifications     │   │   charge → pay driver → │
                │  → analytics         │   │   receipt               │
                │  → pricing           │   │  compensations on fail  │
                └─────────────────────┘   └────────────────────────┘

 ═══════════ LIVE TRACKING (rider watches driver) ═══════════

  [Rider WS] ◄── WS GATEWAY ◄── pub/sub channel: trip:{trip_id}
                                        ▲
                                        │ throttled to ~1 update/2s
                            Location Gateway publishes ONLY for
                            drivers currently on an active trip
                            (not all 5M drivers — critical filter)
```

</details>

Two workloads meet in this design: a constant stream of driver positions through the Location Gateway, and rider requests that go through matching and become trips. The Redis geo index is where they connect.

1. A rider's `POST /rides` creates a trip in the Ride Service with state `REQUESTED` and hands it to the Matching Service, which runs GEOSEARCH on the Redis geo index within 3 km, covering the target cell and its 8 neighbours.
2. It filters candidates by availability, vehicle type, rating and heartbeat.
3. It ranks the rest by routed ETA from the Routing / ETA Service rather than by straight-line distance.
4. It acquires a per-driver lock with `SET NX PX` and a 30-second expiry, plus a fencing token, so the driver can't be assigned twice.
5. It offers the trip and waits 15 seconds. A reject or timeout moves it to the next candidate.
6. Once a driver accepts, the Trip Service runs the state machine from `MATCHED` through `ARRIVING` and `IN_PROGRESS` to `COMPLETED`, records each change in `trips` and `trip_events`, and starts the saga on completion: charge, pay the driver, send the receipt.

The geo index is fed by the location paths. Every 4 seconds a driver's position reaches the Location Gateway, which overwrites that driver's entry synchronously, with a 30-second TTL that doubles as liveness, and sends the ping asynchronously to Kafka `location.stream`. Flink / Spark streaming turns that stream into ETA models and analytics and writes history to `location_hist` in S3. For drivers on an active trip only, the gateway also publishes to `trip:{id}`, throttled to one update every 2 seconds, which the rider's live map subscribes to.

---
