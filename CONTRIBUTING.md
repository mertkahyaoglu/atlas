# Contributing

Thanks for looking. This is a reading app, and most of its value is the writing
rather than the code, so the contribution rules lean harder on the prose than a
typical repository's would.

## What's wanted

**Corrections.** A wrong number, a broken invariant, a design that no longer
matches how the system actually behaves, a diagram whose arrows disagree with
the text. These are the most useful thing you can send, and they need no prior
discussion — open a pull request directly.

**Bugs in the app.** Rendering problems, a diagram that fails to parse, broken
navigation, an accessibility defect. Also fine to send directly.

**New documents.** Welcome, but open an issue first so we can agree the scope
before you write three thousand words. A design that duplicates an existing one
at a different scale is usually better as a second tab on the existing page than
as a new document.

## What isn't

**Style rewrites.** The documents have a deliberate voice: plain sentences,
concrete numbers, no hedging, no filler. Pull requests that rewrite existing
prose to a different taste will be declined, even when the new wording is
perfectly good. If a passage is genuinely unclear, open an issue describing what
you misread and why — that's the useful signal.

**Scope expansion without discussion.** A document that grows to cover
everything adjacent to its topic stops being readable in one sitting. Each page
is meant to be finishable.

## Before you open a pull request

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
```

All four must pass; CI runs the same set. The build must also be free of
`[content]` warnings — `lib/content.ts` warns instead of failing when a document
is missing frontmatter, and CI treats those warnings as errors.

Adding a document, the frontmatter it needs, and how the diagrams work are all
covered in the [README](README.md). Copy an existing file in the same group as
your template; `content/designs/02-chat-slack.md` is the most complete design.

## Sign your commits (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/).
It is not a copyright assignment — you keep the copyright in what you write. It
is a statement that you have the right to contribute the work under this
project's licenses, so that the project can keep publishing it.

Add a sign-off line to each commit:

```bash
git commit -s -m "Fix the throughput number in the rate limiter design"
```

That appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must be real and must match the commit author. If you forget,
`git commit --amend -s` fixes the last commit, and
`git rebase --signoff main` fixes a branch.

## Licensing of contributions

This repository is licensed in two parts, and which one applies to your
contribution depends on what you changed:

- Anything under `content/` — the documents, the scripts — is
  **[CC BY-SA 4.0](LICENSE-CONTENT)**. Contributions to it are published under
  that same license, which is what ShareAlike requires.
- Everything else — the application code — is **[MIT](LICENSE)**.

By signing off on a commit you are confirming you are entitled to submit it
under the license that covers the files it touches.
