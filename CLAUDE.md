@AGENTS.md

# GardenProof project notes
- Read `docs/BUILD_BRIEF.md` (product, non-negotiables, conventions) and `README.md` before changing code.
- Shared contracts: `src/lib/domain.ts`, `src/db/schema.ts`, `src/lib/privacy.ts` (the only rule for public images), `src/lib/tenant.ts`.
- Slow work goes through the task queue (`src/lib/tasks`), never inside a request.
- Quality gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm eval`.
