import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientRatesTable } from './client-rates-table';
import { Toaster } from '@/components/ui/toaster';

// Verifies that after Molly turns ON "Bills by visit type" for a client that
// has no visit rates yet, she is taken straight to the Add Visit Rate dialog
// so new visit entries don't bill at $0.

let clientRates: Record<string, unknown>[];
let client: Record<string, unknown>;
let hourlyCount: number;
let billingPatchBodies: unknown[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  // Only an hourly rate — no per-visit rates yet.
  clientRates = [
    {
      id: 'crate-1',
      clientId: 'client-1',
      clientName: 'Hourly Test Clinic',
      visitType: 'hourly',
      rate: 60,
      effectiveDate: '2026-01-01',
    },
  ];
  client = {
    id: 'client-1',
    name: 'Hourly Test Clinic',
    active: true,
    isDemo: false,
    mileageOnContract: true,
    billsByVisitType: false,
  };
  hourlyCount = 0;
  billingPatchBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/client-rates') return jsonResponse(clientRates);
      if (path === '/api/clients') return jsonResponse([client]);
      if (path === '/api/clients/client-1/visit-entry-count')
        return jsonResponse({ count: 0 });
      if (path === '/api/clients/client-1/hourly-entry-count')
        return jsonResponse({ count: hourlyCount });
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

async function openBillingAndTurnOnVisits(user: ReturnType<typeof userEvent.setup>) {
  renderTable();
  await screen.findByText('Hourly Test Clinic');
  await user.click(screen.getByTestId('button-edit-billing-client-1'));
  const toggle = await screen.findByTestId('switch-bills-by-visit-type');
  expect(toggle).toHaveAttribute('data-state', 'unchecked');
  await user.click(toggle);
  await user.click(screen.getByTestId('button-save-billing'));
}

describe('add-visit-rate prompt after turning on visit billing', () => {
  it('opens the Add Visit Rate dialog after saving when the client has no visit rates', async () => {
    const user = userEvent.setup();
    await openBillingAndTurnOnVisits(user);

    await waitFor(() => expect(billingPatchBodies).toHaveLength(1));
    expect(billingPatchBodies[0]).toMatchObject({ billsByVisitType: true });

    // Add Visit Rate dialog opens automatically for this client.
    expect(await screen.findByText('Add Visit Rate', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByTestId('select-visit-rate-type')).toBeInTheDocument();
  });

  it('opens the Add Visit Rate dialog after confirming the hourly-entries warning', async () => {
    hourlyCount = 4;
    const user = userEvent.setup();
    await openBillingAndTurnOnVisits(user);

    await screen.findByTestId('text-confirm-visit-on');
    await user.click(screen.getByTestId('button-confirm-visit-on'));

    await waitFor(() => expect(billingPatchBodies).toHaveLength(1));
    expect(await screen.findByText('Add Visit Rate', { selector: 'h2' })).toBeInTheDocument();
  });

  it('does not prompt when the client already has visit rates', async () => {
    clientRates.push({
      id: 'crate-2',
      clientId: 'client-1',
      clientName: 'Hourly Test Clinic',
      visitType: 'soc-RN',
      rate: 336,
      effectiveDate: '2026-01-01',
    });
    const user = userEvent.setup();
    await openBillingAndTurnOnVisits(user);

    await waitFor(() => expect(billingPatchBodies).toHaveLength(1));
    expect(screen.queryByText('Add Visit Rate', { selector: 'h2' })).not.toBeInTheDocument();
  });

  it('does not prompt when turning visit billing off', async () => {
    client = { ...client, billsByVisitType: true };
    const user = userEvent.setup();
    renderTable();
    await screen.findByText('Hourly Test Clinic');
    await user.click(screen.getByTestId('button-edit-billing-client-1'));
    const toggle = await screen.findByTestId('switch-bills-by-visit-type');
    expect(toggle).toHaveAttribute('data-state', 'checked');
    await user.click(toggle);
    await user.click(screen.getByTestId('button-save-billing'));

    await waitFor(() => expect(billingPatchBodies).toHaveLength(1));
    expect(billingPatchBodies[0]).toMatchObject({ billsByVisitType: false });
    expect(screen.queryByText('Add Visit Rate', { selector: 'h2' })).not.toBeInTheDocument();
  });
});
