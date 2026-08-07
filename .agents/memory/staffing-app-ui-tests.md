---
name: Staffing-app UI component tests
description: How component/UI tests are set up in the staffing web app (vitest + jsdom + testing-library)
---

The staffing web app has its own vitest setup (`pnpm --filter @workspace/staffing-app run test`), separate from the api-server suite.

**Pattern:** component tests run the real generated api-client-react hooks against a `vi.stubGlobal('fetch', ...)` router keyed by URL path — do NOT mock the hooks themselves, or query-invalidation/refetch behavior goes untested. (The "never stub global fetch" rule applies only to api-server e2e tests.)

**jsdom gotchas** (handled in `src/test/setup.ts`): Radix Select needs `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture`/`scrollIntoView` polyfills and `window.matchMedia`. Testing-library auto-cleanup does not run without vitest globals — call `cleanup()` in `afterEach` explicitly.

**Mobile (Expo) UI tests:** the employee-mobile app has the same vitest+jsdom pattern (`pnpm --filter @workspace/employee-mobile run test`) with `react-native` aliased to `react-native-web` in vitest.config. Mock expo-router/haptics/vector-icons/safe-area/keyboard-controller; inside `vi.mock` factories use `await import('react-native')` (async factory), never `require('react-native')` — require bypasses the vite alias and hits real react-native's Flow syntax. RNW renders `testID` as `data-testid`, so `getByTestId` works.

**jsdom also lacks ResizeObserver** (Radix Tabs) — polyfilled in setup.ts.

**How to apply:** new UI tests go in `src/**/*.test.tsx` beside the component; verify generated endpoint paths from `getXUrl()` helpers in `lib/api-client-react/src/generated/api.ts` rather than guessing (e.g. send is `/api/qbo/invoice`, singular).
