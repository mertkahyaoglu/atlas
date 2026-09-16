# Distributed Rate Limiter — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design a rate limiter for our public API.

@you
"Rate limiter" covers anything from a Redis counter to a DDoS scrubbing network, so let me narrow it.

1. Limit by what — API key, user, IP? And do different customers get different limits?
2. Is it one global limit per customer across our whole API fleet, or per server?
3. Do some endpoints need tighter limits than others — say an expensive export?
4. How precise does it need to be? Is it fine if a customer on 100 a minute occasionally gets 105?
5. Is volumetric DDoS in scope, or is that handled upstream?

@interviewer
Per key, per user and per IP. Free tier is 100 a minute, pro is 10,000. The limit is global across the fleet. Expensive endpoints get tighter caps. A small overshoot is fine. DDoS is handled by our CDN.

@you
Then here's what I'm building, and what I'm not.

**Functional:** limit requests per identity — user, API key or IP — over a time window; multiple tiers; per-endpoint overrides; return `429` with `Retry-After` and remaining-quota headers; and rules changeable at runtime, without a deploy.

**Non-functional:** added latency under **5ms p99**, because the limiter sits in front of *everything*. It **must not become a single point of failure** — a limiter outage that becomes a total outage is worse than no limiter. **Accurate enough**: a brief small overshoot is acceptable, a 10x overshoot is not. And it scales horizontally with the API tier.

**Out of scope, deliberately:** L3/L4 DDoS mitigation, which lives at the CDN and scrubbing layer, and billing.

@interviewer
Fine.

@you
Let me size it quickly — I think the numbers point at a specific question.

@note · Playbook 10.1, phase 1
"How precise does it need to be?" is the question that sets up the whole design. Getting the interviewer to agree that 105 is fine but 1,000 isn't gives you permission for the bounded-inaccuracy answer later.

## Estimate · 3 min · Small state, huge request rate

@you
- **Traffic:** ~1M requests/sec at the edge.
- **Identities:** ~50M active keys in any window.
- **State:** a token bucket is two numbers — `tokens` and `last_refill_ts` — plus a key, call it ~50 bytes. 50M × 50 bytes is **~2.5 GB**. That fits comfortably in Redis memory, with room for replicas.

The conclusion: **state is small and hot.** Redis is the obvious store, and storage isn't the design question. The design question is **how often we talk to it.** A Redis call is 1–2ms, and at 1M requests/sec that's a million round trips a second added to every request in the company — in front of everything, against a 5ms budget.

@interviewer
1–2ms is inside 5ms. Why not just call Redis on every request?

@you
It's inside the budget on a good day, and it's the simplest correct answer, so I want it on the table. The problem is less the latency than the dependency: a Redis blip becomes an outage of every API we have, and its p99 becomes our p99. I'll show a design that keeps Redis as the source of truth but takes it off the hot path for most requests.

@note · Playbook 10.1, phase 2
Two numbers — 2.5 GB and 1M/sec — and the conclusion is that storage is a non-issue and round-trip frequency is the whole design. Acknowledging the simple answer before improving on it is collaborative, not defensive.

## API and data model · 5 min · A check, a rules API, and keys that clean themselves up

@you
The limiter isn't really a public API — it's a function the gateway calls:

- `allow(identity, endpoint)` → `{allowed, remaining, reset_at, retry_after}`.
- `PUT /admin/limits {scope, identity_tier, endpoint_pattern, limit, window_sec, burst}` — rule configuration.
- Over the limit: **`429 Too Many Requests`** with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`, so well-behaved clients can self-throttle.

@you · at the whiteboard
The state is Redis keys and cached rules:

| Where | Key | The point |
|---|---|---|
| Redis | `rl:{identity}:{endpoint}:{window}` | token-bucket or counter state, **TTL = window length** |
| Config service | `tier` | `{limit, window, burst, endpoint_overrides{}}`, cached on every gateway with a 30s refresh |

The TTL is worth pointing at: counters garbage-collect themselves. There's no cleanup job, and memory is bounded by *active* identities, not total identities.

@interviewer
Which algorithm?

@you
I'll lay out the four, then pick.

| Algorithm | State | The problem |
|---|---|---|
| **Fixed window** | one counter | boundary burst: 100 at 10:00:59 plus 100 at 10:01:00 is 200 in one second |
| **Sliding window log** | every timestamp | exact, but memory grows with traffic |
| **Sliding window counter** | two counters | `curr + prev × overlap` — nearly exact, O(1) memory; a good compromise |
| **Token bucket** | `tokens`, `last_refill_ts` | capacity B for bursts, refill R for the long-run average |

**Token bucket** is my default. Real traffic is bursty, and a client that was idle should be allowed to catch up — that's exactly what capacity models. It's two numbers of state, and refill is computed **lazily on access** — `tokens = min(B, tokens + elapsed × R)` — so there's no background timer. I'd use a leaky bucket only when the downstream genuinely can't absorb bursts, like a third-party API with a hard cap, because it smooths output at the cost of queueing.

@note · Playbook 10.1, phase 3
Knowing all four algorithms is table stakes; recommending one with the product reason — "real traffic is bursty" — is what scores. Mentioning lazy refill pre-empts "who refills the buckets?"

## High-level design · 10 min · Two tiers of state, and where the check runs

@you · drawing
Traffic comes through the **CDN**, which scrubs volumetric attacks, then a **load balancer** spreads it across a **fleet of API gateways**. The limiter runs inside each gateway — not as a separate service, because that would add a network hop to every request.

A request, end to end:

1. The gateway finds the rule for this identity and endpoint in its **local copy of the rules**, refreshed from the config service. If the config service is down, it keeps the last good copy, and falls back to safe defaults only if it has never had one.
2. It checks this identity's **local bucket** in memory. No network call.
3. Tokens available: allow, forward to the backend, and attach the rate-limit headers. Empty: `429` with `Retry-After`.
4. **Asynchronously**, every N requests or every X milliseconds, the gateway syncs that bucket with the **Redis cluster**, which holds the global count.

So the common case costs zero network, and Redis is still where the truth lives.

@interviewer
Why not keep Redis on every request and use local counters as a cache?

@you
Let me compare the options, because this is the actual design decision:

| Approach | Added latency | Accuracy | The catch |
|---|---|---|---|
| Central Redis per request | +1–2ms | exact | a Redis blip is an outage |
| Local counters, quota ÷ N gateways | 0 | poor | unfair under uneven balancing, and wrong the moment N autoscales |
| **Two-tier: local bucket + async sync** | ~0 typical | good, bounded | the one I'd pick |
| Gossip between gateways | 0 | eventual | complex, rarely worth it |

The two-tier design buys near-zero latency and removes Redis from the hot path. The cost is a small, **bounded** overshoot — and it's bounded by a number I can compute, which I'll show in the deep dive.

@interviewer
What does the sync actually do in Redis?

@you
It runs a **Lua script**: read the bucket, apply lazy refill, subtract what this gateway consumed since its last sync, and hand back a fresh local allowance. The point of Lua is atomicity. `GET` then `SET` is a read-modify-write race — two gateways both read 5 tokens, both subtract one, both write 4, and two requests consumed one token. Redis runs a script atomically on its single thread, so check-and-decrement is one indivisible operation and one round trip.

Redis is **sharded by identity**, so everything for one key lives on one node and the script is a single-node operation. If a script touched keys in two hash slots, it couldn't run atomically — so the key design and the script design are the same decision.

@note · Playbook 10.1, phase 4
Put the options in a table when the choice *is* the design. The Lua answer lands two levels deep: why a script (atomicity), then why sharding by identity is what makes the script possible.

## Deep dive · 15 min · Accuracy versus latency, and failing well

@you
I see two hard parts: the accuracy-latency trade in the two-tier design — how much overshoot, and when that's not acceptable — and what happens when Redis itself is down. I'd go with accuracy first, then failure. Does that work?

@interviewer
Go.

@you
Overshoot is bounded by **the number of gateways that saw this key × the sync batch size**. Each of those gateways can spend at most one batch of tokens it hasn't reported yet before it has to sync.

So the batch size can't be a global constant — it has to scale with the limit:

| Tier | Limit | Sync | Worst-case overshoot |
|---|---|---|---|
| Pro | 10,000/min | every ~20 requests | a few hundred across the fleet, a few percent |
| Free | 100/min | every request or two | a handful |

A free key at 100 a minute is under two requests a second, so syncing on nearly every one of its requests costs Redis almost nothing. The keys that generate real load are the high-limit ones, and those tolerate a larger batch because a few hundred over 10,000 is small. Across the fleet, a sync per ~100 requests on average is ~10k Redis calls a second instead of a million.

@interviewer
So is every limit two-tier?

@you
No, and this is the distinction I want to make explicitly. There are **traffic-shaping limits** and **correctness limits**.

- "100 requests a minute" is traffic shaping. Brief overshoot to 105 hurts no one, so two-tier.
- "One free trial per account" or "three password attempts" is correctness. An overshoot of even one is a bug — a second free trial is lost money, a fourth password guess is a security hole. Those go through an **exact, synchronous Redis check** on every request, accepting the round trip, because those endpoints are rare and the limit is the whole point.

The rule's config carries which mode it's in.

@interviewer
Redis goes down. What happens?

@you
Two options, and both have a cost.

- **Fail closed** — reject everything. That turns a limiter outage into a total outage of every API.
- **Fail open** — let everything through. That risks the backends being overwhelmed by exactly the traffic the limiter existed to stop.

My answer is **fail open on the local bucket**. Each gateway keeps enforcing its local limit — roughly the global limit divided by the gateways, the "poor accuracy" option from the table — so we're not unprotected, just imprecise. Serve the traffic and alert loudly. And the correctness limits from a minute ago fail **closed**, because a free-trial endpoint returning an error for five minutes is far better than giving away free trials.

What I care about is saying the reasoning, not just the choice: a limiter that protects the backend must not become the thing that takes the backend's traffic down.

@interviewer
One huge customer sends a quarter of all traffic. What happens to their key?

@you
It's a hot key: all its state and all its syncs land on one Redis shard, and that shard's latency rises for everyone else hashed there. Two fixes. Give the largest tenants **dedicated shards**. Or split their key into sub-buckets — `key#0` through `key#9`, each with a tenth of the limit — and pick one at random per request. The sub-buckets spread across shards, and the sum is still the limit.

@interviewer
What should you limit by? User ID seems fairest.

@you
It is, but it requires authentication — so the **login endpoint itself must be limited by IP**, or it's an open credential-stuffing target. And IP is blunt: a corporate NAT puts thousands of users behind one address, and attackers rotate through proxies.

So limits are **layered**: IP at the edge, API key at the gateway, user ID at the service, plus per-endpoint overrides for expensive operations. And "1,000 a day" alongside "10 a second" is just multiple buckets checked in sequence — deny if any denies, and return the most restrictive `Retry-After`.

@interviewer
What about limiting by cost rather than by request count?

@you
It's a natural extension of the token bucket: give each endpoint a weight and deduct that many tokens. A search costs 1, a bulk export costs 50. That's how most real API quota systems work, and it needs no new state.

@note · Playbook 10.1, phase 5
The senior move on this prompt is splitting limits into traffic-shaping and correctness, and giving them different consistency *and* different failure modes. Computing the overshoot bound instead of asserting it's "small" is what depth looks like here.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, the first pressure is **Redis sync volume and hot tenants** — the biggest customers outgrow shared shards first. After that, the number of buckets: at a billion active identities, most keys never come close to their limit but each one costs memory and syncs.

At 100x, what I'd change:

1. **Per-IP limits move to the edge.** At 100M requests a second a large share is abusive, and hauling it to a region just to reject it pays for the bandwidth twice.
2. **Most keys stop getting a bucket.** A count-min sketch per gateway spots heavy hitters; only keys above ~50% of their limit get a real bucket and join the sync.
3. **Regional Redis, with global limits as leases.** A global quota service leases each region a share of every global limit and rebalances by demand. Overshoot becomes regions × lease slack — still a number you can state.

@interviewer
A client ignores `429`s and keeps hammering.

@you
Escalate. Exponentially longer cooldowns first, then a temporary block pushed to the **CDN or WAF**, so that traffic stops reaching our gateways at all. Rejecting a request is cheap, but not free, and a client that ignores `Retry-After` has told us they'll never stop on their own.

Client-side rate limiting helps — respecting `Retry-After`, self-throttling — and our SDKs should do it. But it's never a substitute, because you can't trust the client.

@interviewer
How do you change a limit safely?

@you
**Shadow mode** first. Evaluate the new rule on real traffic and log what it *would* have rejected, without rejecting anything. If the log shows a major customer about to be cut off, we learn that from a dashboard instead of from their CTO. Then enable, ideally region by region.

@you
What I'd monitor: **rejection rate per tier**, because a spike is either an attack or a misconfigured limit and I need to tell which; Redis p99; **sync lag**, since it's what bounds overshoot; the **measured overshoot** itself, sampled against the exact count; and how often gateways are running in fail-open mode.

@you
To close: token buckets with lazy refill, kept locally on every gateway and synced to identity-sharded Redis through an atomic Lua script. That takes Redis off the hot path at the cost of an overshoot I can compute and bound. Correctness limits skip the local tier and fail closed; everything else fails open on the local bucket. If I had another week, I'd build shadow mode first, because a bad limit rolled out everywhere at once is the most likely outage this system will ever cause.

@note · Playbook 10.5
Ending on "the most likely outage this system causes is a bad rule" shows you've thought about the limiter as something that can hurt, not just protect. Shadow mode and the rejection-rate metric are the operational answers interviewers are waiting for on this prompt.
