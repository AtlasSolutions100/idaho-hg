import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The edit screen must never fall back to a blank "new entry" form when the
// requested entry id is stale or missing — that would silently create a
// duplicate instead of editing. These tests pin the guard states.

let searchParams: Record<string, string | undefined> = {};
const routerBack = vi.fn();

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => searchParams,
  useRouter: () => ({ back: routerBack, push: vi.fn(), replace: vi.fn() }),
  Redirect: () => null,
}));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(),
  NotificationFeedbackType: { Success: 'success' },
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
vi.mock('react-native-keyboard-controller', async () => {
  const { ScrollView } = await import('react-native');
  return { KeyboardAwareScrollView: ScrollView };
});

import LogEntryScreen from './log-entry';

const EMPLOYEE = { id: 'emp-1', name: 'Sarah Martinez', role: 'RN', active: true };

const ENTRIES = [
  {
    id: 'te-1',
    employeeId: 'emp-1',
    clientId: 'c1',
    clientName: 'Willow Creek Home Health',
    date: '2026-08-03',
    timeIn: '09:00',
    timeOut: '13:30',
    hours: 4.5,
    status: 'draft',
  },
  {
    id: 'te-approved',
    employeeId: 'emp-1',
    clientId: 'c1',
    clientName: 'Willow Creek Home Health',
    date: '2026-08-01',
    timeIn: '08:00',
    timeOut: '12:00',
    hours: 4,
    status: 'approved',
  },
];

const CLIENTS = [
  { id: 'c1', name: 'Willow Creek Home Health', mileageOnContract: true, billsByVisitType: false },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/me') return jsonResponse(EMPLOYEE);
      if (path === '/api/clients') return jsonResponse(CLIENTS);
      if (path === '/api/time-entries' && (!init?.method || init.method === 'GET')) {
        return jsonResponse(ENTRIES);
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  searchParams = {};
});

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LogEntryScreen />
    </QueryClientProvider>,
  );
}

describe('log-entry edit mode with a bad or stale id', () => {
  it("shows the couldn't-find-that-entry state, never a blank new-entry form", async () => {
    searchParams = { id: 'stale-or-deleted-id' };
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('text-edit-unavailable')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('text-edit-unavailable').textContent).toContain(
      "We couldn't find that entry",
    );
    // No form fields — a blank form here would create a duplicate entry.
    expect(screen.queryByTestId('button-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-time-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chip-client-c1')).not.toBeInTheDocument();
  });

  it('shows the locked message for an approved entry instead of the form', async () => {
    searchParams = { id: 'te-approved' };
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('text-edit-unavailable')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('text-edit-unavailable').textContent).toContain(
      'approved and can no longer be changed',
    );
    expect(screen.queryByTestId('button-submit')).not.toBeInTheDocument();
  });

  it('opens a valid entry prefilled for editing', async () => {
    searchParams = { id: 'te-1' };
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('input-time-in')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('text-edit-unavailable')).not.toBeInTheDocument();
    expect((screen.getByTestId('input-time-in') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByTestId('input-time-out') as HTMLInputElement).value).toBe('13:30');
    expect(screen.getByText('Edit Entry')).toBeInTheDocument();
  });
});
