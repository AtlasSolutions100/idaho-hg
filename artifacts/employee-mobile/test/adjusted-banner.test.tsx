import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Heads-up cue on the home screen when Molly adjusts an entry: banner +
// "Adjusted" badge for adjustments newer than the on-device seen marker,
// and "Got it" persists the marker so the cue stays cleared.

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  Redirect: () => null,
}));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
vi.mock('@expo/vector-icons', async () => {
  const { Text } = await import('react-native');
  return {
    Feather: ({ name }: { name: string }) =>
      React.createElement(Text, { testID: `icon-${name}` }, name),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      storage.set(k, v);
    }),
  },
}));

import HomeScreen from '../app/index';

const EMPLOYEE = { id: 'emp-1', name: 'Sarah Martinez', role: 'RN', active: true };

const BASE = {
  employeeId: 'emp-1',
  clientId: 'c1',
  clientName: 'Willow Creek Home Health',
  date: '2026-08-03',
  hours: 4,
  status: 'submitted',
};

let entries: Record<string, unknown>[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  storage.clear();
  entries = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/me') return jsonResponse(EMPLOYEE);
      if (path === '/api/time-entries' && (!init?.method || init.method === 'GET')) {
        return jsonResponse(entries);
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

describe('HomeScreen — adjusted heads-up banner', () => {
  it('shows banner + badge for a new adjustment; Got it clears and persists', async () => {
    entries = [
      { ...BASE, id: 'te-adjusted', adminEditedAt: '2026-08-05T14:00:00.000Z', adminEditSummary: 'Hours 4 → 5' },
      { ...BASE, id: 'te-plain' },
    ];
    renderHome();

    await waitFor(() => expect(screen.getByTestId('banner-adjusted')).toBeTruthy());
    expect(screen.getByText(/Molly adjusted one of your entries/)).toBeTruthy();
    expect(screen.getByTestId('badge-adjusted-te-adjusted')).toBeTruthy();
    expect(screen.queryByTestId('badge-adjusted-te-plain')).toBeNull();

    fireEvent.click(screen.getByTestId('button-dismiss-adjusted'));
    await waitFor(() => expect(screen.queryByTestId('banner-adjusted')).toBeNull());
    expect(screen.queryByTestId('badge-adjusted-te-adjusted')).toBeNull();
    expect(storage.get('adjustments-seen:emp-1')).toBe('2026-08-05T14:00:00.000Z');

    // Fresh mount — the cue stays cleared.
    cleanup();
    renderHome();
    await waitFor(() => expect(screen.getByTestId('entry-te-adjusted')).toBeTruthy());
    expect(screen.queryByTestId('banner-adjusted')).toBeNull();
  });

  it('only flags adjustments newer than the stored marker', async () => {
    storage.set('adjustments-seen:emp-1', '2026-08-04T00:00:00.000Z');
    entries = [
      { ...BASE, id: 'te-old', adminEditedAt: '2026-08-03T10:00:00.000Z' },
      { ...BASE, id: 'te-new', adminEditedAt: '2026-08-05T10:00:00.000Z' },
    ];
    renderHome();

    await waitFor(() => expect(screen.getByTestId('banner-adjusted')).toBeTruthy());
    expect(screen.getByTestId('badge-adjusted-te-new')).toBeTruthy();
    expect(screen.queryByTestId('badge-adjusted-te-old')).toBeNull();
  });

  it('shows no banner when nothing was adjusted', async () => {
    entries = [{ ...BASE, id: 'te-plain' }];
    renderHome();

    await waitFor(() => expect(screen.getByTestId('entry-te-plain')).toBeTruthy());
    expect(screen.queryByTestId('banner-adjusted')).toBeNull();
  });
});