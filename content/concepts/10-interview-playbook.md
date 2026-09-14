---
group: "concept"
order: 10
title: "The Interview Playbook"
summary: "The 45-minute framework with a time budget, prompts mapped to concepts, sentences that score, what loses points, and the rubric you're graded against."
tags: ["estimation"]
---

# Module 10: The Interview Playbook

Knowing the concepts is necessary but not sufficient. This module is about delivery.

---

## 10.1 The framework, with time budget

For a 45-minute round:

| Phase | Time | What you do |
|---|---|---|
| **1. Clarify** | 5 min | Functional requirements, non-functional requirements, explicit scope cuts |
| **2. Estimate** | 3 min | Traffic, storage, bandwidth — and one conclusion drawn from them |
| **3. API + data model** | 5 min | The contract and the schema, including partition/sort keys |
| **4. High-level design** | 10 min | Boxes and arrows, request flow end to end |
| **5. Deep dive** | 15 min | One or two genuinely hard parts, in real detail |
| **6. Bottlenecks & wrap** | 5 min | Scale limits, failure modes, what you'd monitor, what you'd do next |

Two failure modes to avoid: spending 30 minutes on requirements and never designing anything, and jumping straight to boxes without asking a single question. Both are common.

### Phase 1: Clarify

Ask about:
- **Scope**: which features are in? Explicitly cut things. "I'll leave search out and focus on the write and read paths."
- **Scale**: how many users, how much traffic, read:write ratio?
- **Non-functional priorities**: is this latency-sensitive? Can it tolerate staleness? What's the availability target?
- **Constraints**: mobile clients? multi-region? regulatory requirements?

State your assumptions out loud even when the interviewer is vague: *"I'll assume 10 million daily actives and a 100:1 read:write ratio unless you'd like different numbers."* This is better than asking six questions in a row, and it keeps you moving.

### Phase 2: Estimate

Covered in Module 1.8. The one rule: **every number must produce a conclusion.** If your estimate doesn't change a decision, you wasted three minutes.

### Phase 3: API and data model

Write 4-6 endpoints. Then the schema, and for each table say the partition key and why. This is where you demonstrate that you've matched storage to access pattern (Module 2).

### Phase 4: High-level design

Draw the components and trace one request from client to storage and back. Then trace a second, different flow (usually the write path if you traced the read path). Keep it simple at this stage — you'll add complexity in the deep dive, and a design that starts complicated is hard to follow.

### Phase 5: Deep dive

The most important phase. Pick the part that's *actually hard* and go deep. If the interviewer doesn't direct you, propose: *"I think the interesting part here is the fan-out strategy. Want me to go deep on that, or would you rather I cover the real-time delivery path?"* Offering a choice is confident and lets them steer toward what they want to assess.

### Phase 6: Bottlenecks and wrap

Volunteer weaknesses. *"The hot partition on popular repos is the first thing that would break at 10x. Second would be the fan-out worker throughput. Here's what I'd do about each."* Naming your design's limits reads as senior; claiming it has none reads as inexperienced.

---

## 10.2 The concept-to-prompt map

Most prompts are combinations of a few concept clusters. Recognize the cluster and you know what to reach for.

| Prompt | Primary concepts | The hard part they're probing |
|---|---|---|
| Twitter / Instagram feed | Fan-out (M6), caching (M4), wide-column (M2) | Celebrity problem, hybrid fan-out |
| Notification system | Fan-out (M6), pub/sub (M5), DLQ (M5) | Fan-out strategy, multi-channel delivery, dedupe |
| Chat / Slack | WebSockets (M7), connection registry (M7), ordering (M5) | Routing to the right gateway, offline delivery, message ordering |
| URL shortener | ID generation (M9), caching (M4), read:write skew (M1) | Cache strategy, key generation without collisions |
| Rate limiter | Token bucket (M7), distributed counters (M7) | Distributed accuracy vs latency |
| Web crawler | Queues (M5), Bloom filters (M9), politeness | Dedupe at scale, per-domain rate limiting, trap avoidance |
| Search / typeahead | Inverted index (M9), tries (M9), sharding (M2) | Scatter-gather latency, index freshness |
| Uber / delivery tracking | Geospatial (M9), streaming (M9), matching | High-write location updates, matching algorithm |
| Payment system | ACID (M3), idempotency (M3), saga (M3) | Exactly-once effects, reconciliation, audit |
| Video streaming (YouTube/Netflix) | Object storage (M9), CDN (M4), batch transcoding (M9) | Upload pipeline, adaptive bitrate, CDN strategy |
| Google Docs / collaborative editing | Conflict resolution (M2 CRDTs/OT), WebSockets (M7) | Concurrent edit convergence |
| Ticketmaster / booking | Locking (M9), ACID (M3), queueing (M5) | Preventing double-booking under contention |
| Dropbox / file sync | Chunking, dedupe, object storage (M9), conflict resolution | Delta sync, conflict handling |
| Ad click aggregation | Stream processing (M9), windowing (M9), exactly-once (M5) | Event-time windows, late data, dedupe |
| Distributed cache | Consistent hashing (M2), eviction (M4) | Rebalancing, hot keys |

---

## 10.3 Sentences that score

These are patterns, not scripts. Adapt them.

**On trade-offs:**
> "I'm choosing X over Y. X gives us [benefit], and the cost is [specific cost]. I think that's the right call here because [product requirement]."

**On consistency:**
> "I'd take availability over consistency here. A user seeing a two-second-stale unread count is invisible; a failed page load isn't."

**On delivery guarantees:**
> "I'll assume at-least-once delivery with idempotent consumers, since true exactly-once across system boundaries isn't achievable and the complexity isn't worth it here."

**On preempting the celebrity problem:**
> "This works for the median user, but it breaks down for accounts with millions of followers, so let me describe a hybrid."

**On not over-engineering:**
> "At this scale a single Postgres instance handles the write volume comfortably. I'd design the schema to be shardable, but I wouldn't shard on day one."

**On failure:**
> "If this dependency is slow rather than down, we'd exhaust our connection pool waiting on it, so I'd add a timeout and a circuit breaker with a fallback to cached data."

**On monitoring:**
> "The metric I'd alert on is consumer lag, because it rises before user-visible symptoms appear."

**When you don't know:**
> "I haven't worked with that specific system, but by analogy it should behave like [thing you do know]. Let me reason from there and you can correct me."

That last one is genuinely fine to say. Confident reasoning from first principles beats a confident wrong answer, and interviewers notice bluffing.

---

## 10.4 What loses points

- **Buzzword dropping without justification.** Saying "Kafka" is worth nothing; saying "Kafka because I want replay so a new consumer can rebuild its state from history" is worth a lot.
- **Designing for scale that was never stated.** If the interviewer said 1,000 users and you propose global multi-region sharding, you've shown poor judgment, not ambition.
- **Silence.** Thinking quietly for two minutes reads as being stuck. Narrate: "I'm weighing whether to fan out eagerly here — let me think about the write volume."
- **Ignoring the interviewer's hints.** If they ask "what happens if that node fails?" three times, they're not curious, they're telling you the design has a gap.
- **Defending a choice past the point of evidence.** Change your mind out loud when given a good reason: "Good point, that breaks at 10x. Let me revise."
- **Getting stuck in one area.** Spending 25 minutes perfecting the schema and never discussing failure handling means large sections of the rubric go unscored.
- **Claiming exactly-once, claiming CAP lets you pick two, or claiming a design has no bottlenecks.** These are specific credibility hits.
- **Skipping requirements.** The single most common mistake. Designing the wrong system perfectly scores zero.

---

## 10.5 The rubric you're actually being scored against

Most companies score roughly these dimensions:

1. **Requirements and scoping** — did you clarify before designing, and cut scope sensibly?
2. **High-level design** — is it coherent, complete, and does it satisfy the stated requirements?
3. **Depth** — when pushed on any component, can you go two or three levels deeper?
4. **Trade-off reasoning** — do you make choices consciously and articulate the cost?
5. **Scale and bottleneck awareness** — do you know what breaks first and why?
6. **Operational maturity** — failure modes, monitoring, deployment, degradation.
7. **Communication** — is it followable? Do you structure, signpost, and engage collaboratively?

Note that **depth** and **trade-off reasoning** are where senior candidates separate from mid-level ones. A mid-level candidate produces a correct diagram. A senior candidate produces a correct diagram, identifies which two boxes are actually hard, and explains what they'd sacrifice to make them work.

Note also that **communication** is a real scored dimension, not a soft extra. An excellent design that the interviewer couldn't follow scores badly, because the interviewer's actual question is "would I want to plan a project with this person?"

---

## 10.6 A two-week preparation plan

**Days 1-4 — Foundations.** Read Modules 1-4. For each, do the checklist at the end out loud without notes. If you can't explain replication lag or cache stampede to an imaginary junior engineer, re-read that section.

**Days 5-7 — Patterns.** Read Modules 5-7. These contain the highest-density interview material (messaging, fan-out, real-time). Draw the Kafka partition diagram and the hybrid fan-out diagram from memory until they're automatic.

**Days 8-9 — Operations and components.** Read Modules 8-9. These are where most candidates are weakest, so they're high-leverage.

**Days 10-14 — Practice under time pressure.** Do one full 45-minute design per day, out loud, on a whiteboard or blank document, with a timer. Suggested sequence, chosen to cover distinct concept clusters:

1. Design a notification system (fan-out, pub/sub, delivery)
2. Design a URL shortener (estimation, caching, ID generation)
3. Design a chat application (WebSockets, ordering, offline delivery)
4. Design a rate limiter (algorithms, distributed state)
5. Design a news feed with ranking (fan-out plus the ranking layer)

After each, audit yourself against the rubric in 10.5. Score each dimension 1-5 and find your lowest one. That's what to work on next, not the thing you already enjoy.

---

## 10.7 Final compression

If you remember nothing else, remember that almost every design decision is one of these four trades, and that naming which one you're making is most of the job:

1. **Now or later** — precompute vs compute on demand (fan-out on write vs read; caching; denormalization; batch vs stream)
2. **One copy or many** — replication, caching, and CDNs all buy speed and availability with consistency
3. **One machine or many** — vertical vs horizontal, and sharding buys capacity with coordination complexity
4. **Correct or available** — CAP, consistency models, quorums, ACID vs BASE

Everything in Modules 1-9 is an instance of one of these. If you get a prompt you've never seen, identify which trade the problem is fundamentally about, pick a side, and defend it with the product requirement. That's the skill.
