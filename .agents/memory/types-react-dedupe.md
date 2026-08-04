---
name: Duplicate @types/react breaks web typecheck
description: Why pinning a different @types/react in one workspace package breaks others
---

- If any workspace package pins a different `@types/react` than the catalog (e.g. Expo's suggested `~19.1.x`), pnpm's hidden hoisted fallback (`node_modules/.pnpm/node_modules/@types/react`) can flip to that version. Packages without a declared `@types/react` peer (e.g. `react-day-picker`) then resolve the wrong copy, producing "two different types with this name exist" errors in unrelated apps.
- **Why:** hit when adding Clerk/Expo auth deps; staffing-app typecheck broke in untouched shadcn ui files.
- **How to apply:** keep exactly one `@types/react` version — use `"catalog:"` in every package. Expo's version-mismatch warning for `@types/react` is types-only and safe to ignore/exclude (`expo.install.exclude`). Diagnose with `find node_modules/.pnpm -maxdepth 1 -name "@types+react@*"`.
