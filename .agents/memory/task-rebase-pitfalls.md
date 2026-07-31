---
name: Task rebase pitfalls
description: What to re-verify after a task branch is rebased onto main in this monorepo
---

Rule: after any rebase onto main (including the one triggered by task completion), re-verify before resubmitting:
1. `pnpm run typecheck` — the semantic merge tool has scrambled Express route handlers in `artifacts/api-server/src/routes/*` (mixed bodies between handlers, stray fragments after `export default router;`). When a handler looks mangled, rebuild it from `git show main-repl/main:<file>` plus this task's intended change instead of patching line by line.
2. `pnpm install` — main may add dev deps (e.g. vitest) that the task env lacks; validation runs `pnpm --filter @workspace/api-server run test`.
3. `pnpm --filter @workspace/db run push` — main may add tables (e.g. onboarding_items) the task DB doesn't have; the API server crashes at startup otherwise.

**Why:** all three bit during one task completion: corrupted reports/rates routes, `vitest: not found` in validation, and a startup crash on a missing table.
**How to apply:** treat rebase completion as untrusted; smoke-test the affected endpoints with curl before `markTaskComplete`.
