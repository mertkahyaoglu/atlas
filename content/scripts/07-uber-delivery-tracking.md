# Uber / Delivery Tracking — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design the core of Uber: drivers, riders, matching them, and tracking the ride.

@you
That's a big surface, so let me agree which parts we're designing.

1. Drivers publish their location continuously — how often? Every few seconds?
2. A rider requests a ride from A to B, and we offer it to nearby drivers. Is it one driver at a time, and can they decline?
3. After matching, the rider sees the driver moving on a map until pickup and through to dropoff?
4. Is pricing and surge in scope? Routing and ETAs?
5. Are we multi-city, multi-region?

@interviewer
Every four seconds or so. Offer to one driver at a time, and they can decline. Yes to live tracking through dropoff. Leave pricing out, and treat routing as a service you can call. Many cities, many regions.

@you
Then here's what I'm building, and what I'm not.

**Functional:** drivers publish location continuously; a rider requests a ride; we find nearby available drivers and offer the trip; the driver accepts; the rider sees live driver position until dropoff; and the trip moves through requested, matched, en route, in progress, completed, paid.

**Non-functional:** match within a few seconds. Location freshness of about five seconds — stale but recent is fine. **Never double-assign a driver** — that's the one place I need strong consistency, and I want to scope it that narrowly. High availability, and a region failing must not take down other regions.

**Out of scope, deliberately:** pricing and surge algorithms, routing and ETA internals — I'll call a routing service — and fraud.

@interviewer
Numbers?

@you
Yes. One of them rules out most of the obvious designs.

@note · Playbook 10.1, phase 1
"Strong consistency at the assignment point only" is the requirement that shapes the deep dive. Stating it as a *narrowly scoped* guarantee, rather than "the system must be consistent", is the mature instinct this prompt checks for.

## Estimate · 3 min · The headline number, and what it rules out

@you
- **Drivers online:** 5M.
- **Location updates:** every 4 seconds, so 5M ÷ 4 = **1.25M writes/sec**. That's the headline.
- **Ride requests:** ~10,000/sec.
- **Payload:** ~100 bytes a ping, so ~125 MB/sec sustained.

The conclusion: **1.25M writes a second of data that's worthless after ten seconds.** A driver's position from a minute ago is useless for matching. That single fact dictates an **in-memory store for current position**, overwritten rather than appended, with history written **asynchronously** to a separate cold path. Anyone proposing a disk-backed geospatial index for this — PostGIS, say — has missed the point: it would spend all its effort durably storing data we're about to throw away.

@interviewer
And the 10,000 requests a second?

@you
That's small by comparison, but it's the contention number. Ten thousand requests a second, concentrated in city centres at rush hour, means many requests in the same neighbourhood at the same moment looking at the same drivers. So the write rate decides the storage, and the request rate decides the concurrency problem.

@note · Playbook 10.1, phase 2
"Worthless after ten seconds" is the conclusion that does the work — it rules out durability, rules in overwrites, and splits hot from cold. Pointing out that the smaller number is the *harder* one previews both halves of the hard part.

## API and data model · 5 min · Hot state in memory, trips on disk

@you
Drivers and riders each have a write path and a live channel:

- `POST /v1/drivers/location {driver_id, lat, lng, heading, ts}` → `202`. Or a frame on a persistent socket — I'll come back to which.
- A **driver WebSocket** that receives trip offers.
- `POST /v1/rides {pickup, dropoff}` → `201 ride_id`.
- `GET /v1/rides/{id}` → status.
- A **rider WebSocket** that receives driver position once matched.

@you · at the whiteboard
Two stores with very different jobs:

| Store | Key | The point |
|---|---|---|
| Redis `geo:{city_id}` | `GEOADD` sorted set, geohash as score | current driver positions, **overwritten** |
| Redis `driver:{id}:status` | TTL heartbeat | `available \| offered \| on_trip` |
| Redis `lock:driver:{id}` | `SET NX PX` | the assignment mutex |
| Cassandra `trips` | PK `trip_id` | rider, driver, state, timestamps, fare |
| Cassandra `trip_events` | PK `trip_id`, SK `ts` | every state transition — the audit trail |
| Cassandra `location_hist` | PK `(driver_id, day)`, SK `ts` | the cold path, analytics only |

@interviewer
How does a sorted set answer "drivers near me"?

@you
**Geohash** encodes latitude and longitude into a string where nearby points share a prefix, which turns a 2D proximity query into a 1D range scan that any sorted index can serve. Redis stores the geohash as the sorted-set score, so `GEOSEARCH` within 3km is a few range scans.

There's a trap, though. Two points can be ten metres apart on either side of a cell boundary and share no prefix at all. So **always query the target cell plus its eight neighbours**, then filter by true distance. Forget that and the system mysteriously can't find the driver parked across the street.

@interviewer
Why geohash over a quadtree or S2?

@you
Geohash is dead simple and works on any prefix index, but it's a fixed grid — Manhattan and the Pacific get the same cell size. A **quadtree** subdivides only where density is high, which adapts better, but it's more work to maintain under a million updates a second. **S2** projects the sphere onto a cube with a Hilbert curve — better locality, and it handles the poles and the antimeridian correctly; it's what Uber and Google actually use. For today, geohash with the neighbour rule is complete, and I'd move to S2 when density becomes the problem.

@note · Playbook 10.1, phase 3
The eight-neighbours rule is the detail that separates someone who's built a proximity search from someone who's read about one. Naming S2 as what you'd graduate to — and the reason — covers the alternatives without spending the phase on them.

## High-level design · 10 min · A location path and a matching path, meeting in Redis

@you · drawing
Two workloads meet in one place, the Redis geo index. The location path first, running 1.25M times a second.

1. The driver app sends its position to a **location gateway** — stateless, sharded by city.
2. **Hot path, synchronous:** overwrite that driver's entry in the city's **Redis geo index**, with a **30-second TTL**.
3. **Cold path, asynchronous:** send the ping to Kafka `location.stream`, where a stream job feeds ETA models and analytics, and writes history to `location_hist` in object storage.

The TTL is doing a second job: **it's liveness.** A driver whose app crashed silently disappears from the index within 30 seconds. No cleanup job, and no offers sent to phones that aren't listening.

@you
Now a ride request.

1. `POST /rides` creates a trip in state `REQUESTED` and hands it to the **matching service**.
2. `GEOSEARCH` within 3km over the cell and its neighbours.
3. **Filter** by status available, vehicle type, rating, a fresh heartbeat.
4. **Rank by routed ETA**, from the routing service — not by straight-line distance.
5. **Lock** the top candidate, and **offer** the trip. Wait 15 seconds. Reject or timeout: release, next candidate.
6. On accept, the **trip service** moves the trip through its state machine and records every transition in `trip_events`.

@interviewer
Why rank by ETA? The geo query already gives you distance.

@you
Because a driver 500 metres away across a river is fifteen minutes away. Geo distance is great for generating a candidate set cheaply, and bad for choosing. So it's two stages: cheap retrieval by distance, then expensive ranking by routed ETA on a small set — maybe ten drivers. It's the same shape as search: retrieve with a cheap index, rank with an expensive model.

@interviewer
Once matched, how does the rider see the driver move?

@you
Carefully. Publishing all 5M drivers' positions into pub/sub would be catastrophic. **Only drivers on an active trip** publish, to a `trip:{id}` channel, and **only that one rider** subscribes. Throttle to about one update every two seconds, and let the map interpolate between points so it looks smooth. That turns an impossible fan-out into a fan-out of one.

@interviewer
And sharding the Redis index?

@you
**By city or region.** Every matching query is local — nobody in London is matched to a driver in San Francisco — so there's no cross-shard scatter-gather. And it gives regional fault isolation for free: San Francisco's Redis failing doesn't touch London. That's the availability requirement satisfied by the shard key.

@note · Playbook 10.1, phase 4
Three decisions in this phase each turned a scary number into a small one: overwrite instead of append, a fan-out of one instead of five million, and a shard key that is also the failure domain. Say the number before and after.

## Deep dive · 15 min · Matching under contention

@you
There are two hard parts. The location write rate, which I think the in-memory design handles. And **matching under contention** — two riders must never get the same driver — which is the half most people miss. I'd go deep on matching. Or would you rather I go further into the geospatial side?

@interviewer
Matching.

@you
Two riders request from the same block a second apart. Their candidate lists overlap, and both matchers pick the same nearest driver. Without mutual exclusion, both offer him the trip, he accepts one, and the other rider stares at a spinner — or worse, both get told he's coming.

So before offering, the matcher takes a **short-TTL lock** on the driver:

`SET lock:driver:{id} {token} NX PX 30000`

`NX` means only one matcher gets it. The other moves to its next candidate. The lock is released when the driver accepts elsewhere, rejects, or times out — and the **TTL is the safety net**, so a matcher that crashes mid-offer doesn't strand a driver forever.

@interviewer
Is a Redis lock actually safe?

@you
Not on its own, and I want to be honest about that. A matcher can take the lock, hit a long GC pause, wake up after its 30-second TTL has expired — while another matcher has taken the lock and offered the same driver — and then proceed, still believing it holds the lock. Redis locks aren't a correctness guarantee under pause-and-resume.

Two fixes. A **fencing token**: a monotonically increasing number issued with each lock, which the trip service checks, rejecting any assignment carrying an older token than one it's already seen. Or — simpler, and what I'd actually offer first — make the final assignment a **conditional write on the trip row**:

`UPDATE trips SET driver_id = $d WHERE trip_id = $t AND driver_id IS NULL`

plus the matching condition on the driver's side, so the database is the arbiter of record. The Redis lock becomes an optimization that stops two matchers wasting a driver's attention; the conditional write is the guarantee.

@interviewer
So the whole system is strongly consistent?

@you
No — and that's the point. Almost everything here is AP. Driver positions, ETAs, the nearby-driver list can all be a few seconds stale with no harm. **Exactly one operation needs strong consistency: the assignment.** Isolating it to one narrow write, instead of applying consistency system-wide, is what lets the other 1.25M writes a second be cheap.

@interviewer
A driver accepts, then cancels.

@you
Return the trip to the matching pool, release the lock, record it against the driver's acceptance rate, and re-run matching **excluding that driver**. The trip's state machine allows `MATCHED → REQUESTED`, and the transition goes in `trip_events` so support can see what happened.

@interviewer
No drivers within 3km.

@you
Expand progressively — 3, then 5, then 10km. If there's still nobody, queue the request and retry as drivers become available, with an **honest wait estimate** to the rider rather than an indefinite spinner.

@interviewer
Is greedy matching — nearest driver to each request as it arrives — actually the best approach?

@you
It's locally optimal and globally worse. Two riders, two drivers: greedy gives the first rider the closest driver, which can leave the second rider with a driver twelve minutes away when a swap would have made both five minutes. **Batched matching** collects requests over a window of a couple of seconds and solves a bipartite assignment — the Hungarian algorithm or an approximation — over the whole batch. Better global outcomes, at the cost of a couple of seconds added to time-to-match. Uber does a version of this.

It also changes the contention story: if one matcher owns each cell and solves its batch at once, there's no contention inside the cell — locks are only needed for drivers a neighbouring cell's batch also wants.

@you
And trip completion, quickly. Charging the rider, paying the driver and issuing the receipt span three services, so it's a **saga** rather than a distributed transaction: each step idempotent, each with a compensation — a refund if the payout fails, say.

@note · Playbook 10.1, phase 5
The Redis-lock caveat is where this prompt separates levels. Raising the GC-pause failure yourself, then offering the conditional write as "the simplest correct answer", shows you know the difference between a lock that usually works and a guarantee.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x — 50M drivers, 12.5M pings a second — four things change.

1. **Adaptive ping rates.** At a flat 4 seconds, most writes come from parked drivers. Ping every 2 seconds on a trip, every 15 idle, and immediately on a big position change.
2. **Persistent connections** instead of a POST per ping. At this rate TLS and headers cost more than the 100-byte payload, and the same socket carries offers back down.
3. **Cities split into S2 cells.** The densest metros outgrow one sorted set on one node, so a cell router maps cells to shards and splits cells that get too dense. Isolation still holds, because cells never span regions.
4. **Batched matching per cell** becomes the default, because at 100k requests a second most lock attempts would collide.

@interviewer
A whole region's Redis fails.

@you
This is the nice property of ephemeral state: **recovery is automatic.** Drivers republish within four seconds, so a replacement Redis is repopulated almost immediately. In-flight trips are unaffected, because they live in Cassandra, not Redis. Matching in that region pauses for seconds, and no other region notices.

@interviewer
How would surge pricing fit in?

@you
A stream job over `location.stream` and ride requests computes the supply-demand ratio **per cell over a sliding window** and writes a multiplier per cell to Redis. Pricing reads it at quote time. And the price is **locked at quote time**, not recomputed at charge time — a rider who accepted 1.2x must not be charged 2x because surge rose during the ride.

@you
What I'd monitor: **time-to-match p50 and p99**, the number riders feel; offer reject and timeout rates, since a spike means we're offering bad matches; lock contention and conditional-write conflicts per city, which tell me when to switch a city to batched matching; the count of drivers in the index versus drivers connected, since a gap means TTLs or gateways are misbehaving; and location ingest lag.

@interviewer
And food delivery — does this change?

@you
Two things change. One courier carries several orders, so matching becomes batching orders onto routes. And there's a third party, the restaurant, with its own state machine and prep-time estimates, so the courier should arrive when the food does rather than when the order was placed. The geospatial core and the matching contention are identical.

@you
To close: current position in memory, overwritten every four seconds, with TTL as liveness and history on a separate cold path. Matching generates candidates by geohash including neighbours, ranks by routed ETA, and protects assignment with a lock for efficiency and a conditional write for correctness. Strong consistency lives in exactly one write, and everything else is allowed to be a few seconds stale.

@note · Playbook 10.5
"Recovery is automatic because the state is ephemeral" turns a failure-mode question into a design strength — the in-memory choice from the estimate phase paying off again. Closing on "strong consistency in exactly one write" restates the trade the whole design rests on.
