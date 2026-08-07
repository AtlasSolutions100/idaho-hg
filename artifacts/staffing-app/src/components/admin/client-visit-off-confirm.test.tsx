import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientRatesTable } from './client-rates-table';
import { Toaster } from '@/components/ui/toaster';

// Verifies the confirmation flow when Molly turns off "Bills by visit type"
// for a client that still has visit-type entries in recent months, using the
// real generated hooks against a stubbed network layer.

const RATE = {
  id: 'crate-1',
  clientId: 'client-1',
  clientName: 'St. Lukes Test',
  visitType: 'soc',
  rate: 150,
  effectiveDate: '2026-01-01',
};

let client: Record<string, unknown>;
let visitCount: number;
let billingPatchBodies: unknown[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  client = {
    id: 'client-1',
    name: 'St. Lukes Test',
    active: true,
    isDemo: false,
    mileageOnContract: true,
    billsByVisitType: true,
  };
  visitCount = 7;
  billingPatchBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/client-rates') return jsonResponse([RATE]);
      if (path === '/api/clients') return jsonResponse([client]);
      if (path === '/api/clients/client-1/visit-entry-count')
        return jsonResponse({ count: visitCount });
      if (path === '/api/clients/client-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        billingPatchBodies.push(body);
        client = { ...client, ...body };
        return jsonResponse(client);
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientRatesTable />
      <Toaster />
    </QueryClientProvider>,
  );
}

async function openBillingAndTurnOffVisits(user: ReturnType<typeof userEvent.setup>) {
  renderTable();
  await screen.findByText('St. Lukes Test');
  await user.click(screen.getByTestId('button-edit-billing-client-1'));
  const toggle = await screen.findByTestId('switch-bills-by-visit-type');
  expect(toggle).toHaveAttribute('data-state', 'checked');
  await user.click(toggle);
  await user.click(screen.getByTestId('button-save-billing'));
}

describe('turning off visit billing', () => {
  it('warns with the recent visit-entry count and saves only after confirming', async () => {
    const user = userEvent.setup();
    await openBillingAndTurnOffVisits(user);

    // Confirmation appears instead of saving immediately.
    const warning = await screen.findByTestId('text-confirm-visit-off');
    expect(warning.textContent).toContain('7 visit-type entries');
    expect(billingPatchBodies).toHaveLength(0);

    await user.click(screen.getByTestId('button-confirm-visit-off'));
    await waitFor(() => expect(billingPatchBodies).toHaveLength(1));
    expect(billingPatchBodies[0]).toMatchObject({ billsByVisitType: false });
  });

  it('cancelling the warning keeps the client unchanged', async () => {
    const user = userEvent.setup();
    await openBillingAndTurnOffVisits(user);

    await screen.findByTestId('text-confirm-visit-off');
    await user.click(screen.getByTestId('button-cancel-visit-off'));
    await waitFor(() =>
      expect(screen.queryByTestId('text-confirm-visit-off')).not.toBeInTheDocument(),
    );
    expect(billingPatchBodies).toHaveLength(0);
  });

  it('saves without a warning when the client has no recent visit entries', async () => {
    visitCount = 0;
    const user = userEvent.setup();
    await openBillingAndTurnOffVisits(user);

    await waitFor(() => expect(billingPatchBodies).toHaveLength(1));
    expect(screen.queryByTestId('text-confirm-visit-off')).not.toBeInTheDocument();
    expect(billingPatchBodies[0]).toMatchObject({ billsByVisitType: false });
  });
});
