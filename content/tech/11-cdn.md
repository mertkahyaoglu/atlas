---
group: "tech"
order: 11
title: "CDN"
role: "Edge cache"
summary: "Caches near the user that cut latency, absorb read spikes, and shift most traffic off your origin."
tags: ["cdn", "caching", "reliability", "security"]
---

# CDN

## Basics

A CDN is a fleet of caching proxies in points of presence around the world.
Anycast routing sends a user to a nearby one; if that edge has the content it
serves it in a few milliseconds, and if not it fetches from your origin, stores it,
and serves everyone else from the copy.

Two things follow. **Latency** drops because distance drops — a round trip to
another continent costs 150ms no matter how fast your servers are. And **origin
load** drops by whatever the hit ratio is: a 95% hit ratio means your servers see
one request in twenty.

An **origin shield** — a designated mid-tier cache that all edges fetch through —
keeps a viral object from causing hundreds of simultaneous misses to hit you at
once.

## Key concepts and capabilities

**The cache key** is usually the host plus path plus a chosen subset of query
parameters and headers. Getting it wrong is how you either fragment the cache
(keying on a tracking parameter that changes per user) or serve the wrong thing
(failing to vary on `Accept-Language`).

**Cache-Control is the contract.** `max-age` sets edge and browser lifetime,
`s-maxage` sets it for shared caches only, `stale-while-revalidate` lets the edge
serve a slightly stale copy while it refreshes in the background, and
`private`/`no-store` keeps personalised responses out entirely. `ETag` plus
`If-None-Match` turns a refetch into a cheap 304.

**Invalidation: versioned URLs beat purging.** Purge APIs exist and take seconds to
minutes to propagate globally. The robust approach is to make the URL immutable —
`app.a81f3c.js`, `avatar/123/v7.jpg` — cache it for a year, and change the URL when
the content changes. For genuinely dynamic content, a short TTL with
stale-while-revalidate is usually better than trying to purge precisely.

**Dynamic content is cacheable too.** A response every user shares — a top-ten
list, a public profile, the first page of a feed — can be cached at the edge for
5 to 30 seconds. At a million requests per minute that is an enormous reduction in
origin traffic for almost no staleness.

**Video is just segments.** HLS and DASH cut a stream into a few seconds of video
per file plus a manifest. The segments are static and cache perfectly; this is why
a CDN is not an optimisation for streaming but the delivery mechanism itself.

**It is also the security edge.** TLS termination, HTTP/3, DDoS absorption and a
WAF sit there, and signed or tokenised URLs protect private media without your
origin serving the bytes.

## When to use it in an interview

Put a CDN in the diagram whenever there are static assets, images, or video, and
whenever users are spread geographically. That part is uncontroversial and takes a
sentence.

The more interesting uses are worth reaching for deliberately:

- **Absorbing a read spike.** Ticket on-sales, a viral post, a live event. The edge is what stands between a hundred thousand simultaneous readers and your database.
- **The celebrity problem.** One object requested by millions is the ideal CDN case, and often the cleanest answer to a hot-key question.
- **Shaving a global p99.** When the non-functional requirement is "under 200ms worldwide" and your origin is in one region, no amount of backend tuning gets there. Edge caching does.

## What interviewers push on

- **What is the hit ratio, and what does the origin see?** Be ready to multiply: 10M requests/min at a 95% hit ratio still leaves 500k/min reaching you.
- **How do you invalidate?** Versioned URLs for assets, short TTLs for dynamic content, purge only for mistakes and takedowns.
- **Personalisation kills caching.** If every response embeds the viewer's name, nothing is shared. Split the page: cached shell, personalised fragment fetched separately.
- **Cold caches.** A new region, or a purge-everything, sends every edge to the origin at once. Origin shield and request collapsing are the answers.
- **Private content.** Signed URLs with short expiry, and token auth at the edge, so a paid video is not simply a public link.
- **What is not cacheable?** Writes, anything user-specific, and anything that must be correct to the second. Saying what you are *not* caching is as strong as saying what you are.
