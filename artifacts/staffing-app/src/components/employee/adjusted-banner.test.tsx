import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TimeEntry } from '@workspace/api-client-react';
import { TimeEntriesList } from './time-entries-list';

// Heads-up cue when Molly adjusts an entry: a banner + "Adjusted" badges
// appear for adjustments newer than the stored per-employee seen marker,
// and dismissing stores the marker so the cue stays cleared.

const BASE: TimeEntry = {
  id: 'te-1',
  employeeId: 'emp-1',
  clientId: 'c1',
  clientName: 'Willow Creek Home Health',
  date: '2026-08-03',
  hours: 4,
  status: 'submitted',
} as TimeEntry;

let listEntries: TimeEntry[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  listEntries = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/time-entries') return jsonResponse(listEntries);
      throw new Error(`Unexpected fetch: ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimeEntriesList employeeId="emp-1" />
    </QueryClientProvider>,
  );
}

describe('TimeEntriesList — adjusted heads-up banner', () => {
  it('shows a banner and Adjusted badge for a new adjustment, and dismiss clears it persistently', async () => {
    listEntries = [
      { ...BASE, id: 'te-adjusted', adminEditedAt: '2026-08-05T14:00:00.000Z', adminEditSummary: 'Hours 4 → 5' },
      { ...BASE, id: 'te-plain' },
    ];
    renderList();

    await waitFor(() => expect(screen.getByTestId('banner-adjusted')).toBeInTheDocument());
    expect(screen.getByTestId('banner-adjusted')).toHaveTextContent(
      'Molly adjusted one of your entries',
    );
    expect(screen.getByTestId('badge-adjusted-te-adjusted')).toBeInTheDocument();
    expect(screen.queryByTestId('badge-adjusted-te-plain')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-dismiss-adjusted'));
    expect(screen.queryByTestId('banner-adjusted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('badge-adjusted-te-adjusted')).not.toBeInTheDocument();

    // Fresh mount (same employee) — cue stays cleared.
    cleanup();
    renderList();
    await waitFor(() =>
      expect(screen.getByTestId('time-entry-te-adjusted')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('banner-adjusted')).not.toBeInTheDocument();
  });

  it('counts multiple adjusted entries and reappears for adjustments newer than the marker', async () => {
    window.localStorage.setItem('adjustments-seen:emp-1', '2026-08-04T00:00:00.000Z');
    listEntries = [
      { ...BASE, id: 'te-old', adminEditedAt: '2026-08-03T10:00:00.000Z' },
      { ...BASE, id: 'te-new1', adminEditedAt: '2026-08-05T10:00:00.000Z' },
      { ...BASE, id: 'te-new2', adminEditedAt: '2026-08-06T10:00:00.000Z' },
    ];
    renderList();

    await waitFor(() => expect(screen.getByTestId('banner-adjusted')).toBeInTheDocument());
    expect(screen.getByTestId('banner-adjusted')).toHaveTextContent(
      'Molly adjusted 2 of your entries',
    );
    // The already-seen adjustment gets no badge; the details line still shows on its card.
    expect(screen.queryByTestId('badge-adjusted-te-old')).not.toBeInTheDocument();
    expect(screen.getByTestId('badge-adjusted-te-new1')).toBeInTheDocument();
    expect(screen.getByTestId('badge-adjusted-te-new2')).toBeInTheDocument();
  });

  it('shows no banner when nothing was adjusted', async () => {
    listEntries = [{ ...BASE, id: 'te-plain' }];
    renderList();
    await waitFor(() =>
      expect(screen.getByTestId('time-entry-te-plain')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('banner-adjusted')).not.toBeInTheDocument();
  });
});
