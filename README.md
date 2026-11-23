# Daily Draw

Working name for a licensed ₦100 daily number draw: naira product first, on-chain product later.
Every draw can be checked by anyone (see `packages/shared/src/fairness.ts`).

## Documents

- Requirements v0.1: https://claude.ai/artifact/Eefbmz8z8vLZmH8SkGAjhL
- Design v0.1: https://claude.ai/artifact/B7mXA4iX3gaJ5ydLLUYYo7
- Player app mockups (canvas): https://claude.ai/artifact/LyzCSxALf65p8PSZADmdxi — source in `design/mockups/`

## Repository layout

```text
apps/
  api/        NestJS (Fastify) API — the only code that moves money
  worker/     pg-boss jobs: draw open, cutoff, draw, settle, outbox
  ussd/       Africa's Talking USSD handler (menus only)
  web/        Next.js player PWA
  admin/      Next.js admin console
  indexer/    Ponder indexer (R4, not started)
packages/
  shared/     Money, game rules, settlement, fairness protocol — pure, tested
  db/         Postgres migrations and typed Kysely client
  contracts/  Foundry: DrawAnchor.sol (R1); DailyDraw.sol later (R4)
  ui/         Design tokens from the mockups
  api-client/ Generated API client (later)
  config/     TypeScript presets
docs/decisions/  Decision records
```

## Getting started

Requirements: Node 22, pnpm 10, Docker. Foundry is optional (the contract scripts fall back to Docker).

```bash
pnpm install
cp .env.example .env
pnpm services:up          # Postgres, Redis, Anvil
pnpm db:migrate
pnpm build
pnpm test
pnpm contracts:test
```

Run the apps:

```bash
pnpm --filter @daily-draw/api dev      # http://localhost:4000/v1/health
pnpm --filter @daily-draw/worker dev
pnpm --filter @daily-draw/ussd dev     # POST http://localhost:4100/ussd
pnpm --filter @daily-draw/web dev      # http://localhost:3000
pnpm --filter @daily-draw/admin dev    # http://localhost:3001
```

## Rules of the road

- Money is integer kobo (`bigint`) everywhere. Never floats.
- Only `apps/api` and `apps/worker` write to the database. Every money movement is a balanced
  ledger transaction with an idempotency key; the database rejects anything else.
- Play money only outside production.

## SDLC status

1. Planning — done
2. Requirements — v0.1 drafted, awaiting sign-off
3. Design — technical design v0.1 and player mockups drafted
4. Build — **monorepo scaffolded**; next: R1 prototype features
