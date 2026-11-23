# Decision records

One short record per significant decision, so it isn't re-argued later.
Status is **proposed** until the technical lead accepts it. Full reasoning is in the design doc
(https://claude.ai/artifact/B7mXA4iX3gaJ5ydLLUYYo7, "Decision records").

| #   | Decision                                             | Status   |
| --- | ---------------------------------------------------- | -------- |
| 001 | Pooled prizes, never fixed odds                      | proposed |
| 002 | Double-entry ledger in kobo integers                 | proposed |
| 003 | PostgreSQL with Kysely                               | proposed |
| 004 | pg-boss for background jobs                          | proposed |
| 005 | Commit–reveal seed + drand + on-chain Merkle anchor  | proposed |
| 006 | Base for anchors and the on-chain product            | proposed |
| 007 | UUPS proxy behind a 48-hour timelock (DailyDraw)     | proposed |
| 008 | Players claim prizes, with an operator bot as backup | proposed |
| 009 | NestJS monolith plus a worker, not microservices     | proposed |
| 010 | USSD as a thin app calling the API                   | proposed |
| 011 | ESM everywhere; explicit `@Inject()` in NestJS       | proposed |

## 011 — ESM everywhere; explicit `@Inject()` in NestJS

All packages are ES modules (`"type": "module"`, `.js` import suffixes) so shared code runs
unchanged in Node, Next.js and the browser. Dev servers use `tsx`, which does not emit decorator
metadata, so Nest constructor parameters always use `@Inject(Token)` instead of relying on types.
