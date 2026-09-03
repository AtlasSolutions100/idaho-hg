import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LogHoursForm } from './log-hours-form';
import { Toaster } from '@/components/ui/toaster';

// UI coverage for what Molly asked for after the demo:
//   - two evals and a discharge submitted as one day's work
//   - a visit type billed in 15-minute blocks entered as a duration
//   - the visit list narrowed to the employee's own discipline
//   - mileage entered once for a date range
// Real generated hooks against a stubbed network layer, so the request bodies
// asserted here are exactly what the server would receive.

const CLIENTS = [
  {
    id: 'st-lukes',
    name: "St. Luke's Health System",
    mileageOnContract: true,
    billsByVisitType: true,
  },
];

const VISIT_TYPES = [
  { key: 'eval', label: 'Eval / Eval RA', abbreviation: 'Eval', active: true, sortOrder: 10, disciplines: [], billingUnit: 'visit', incrementMinutes: 15 },
  { key: 'discharge', label: 'Discharge (DC)', abbreviation: 'DC', active: true, sortOrder: 20, disciplines: [], billingUnit: 'visit', incrementMinutes: 15 },
  { key: 'skilled-nursing', label: 'Skilled Nursing (SNV)', abbreviation: 'SNV', active: true, sortOrder: 30, disciplines: ['RN', 'LPN'], billingUnit: 'visit', incrementMinutes: 15 },
  { key: 'physical-therapy', label: 'Physical Therapy (PTV)', abbreviation: 'PT visit', active: true, sortOrder: 40, disciplines: ['PT', 'PTA'], billingUnit: 'visit', incrementMinutes: 15 },
  { key: 'hospital-at-home', label: 'Hospital at Home', abbreviation: 'Hospital at Home', active: true, sortOrder: 50, disciplines: [], billingUnit: 'increment', incrementMinutes: 15 },
];

let postBodies: Record<string, unknown>[];
let batchBodies: Record<string, unknown>[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  postBodies = [];
  batchBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/clients') return jsonResponse(CLIENTS);
      if (path === '/api/visit-types') return jsonResponse(VISIT_TYPES);
      if (path === '/api/time-entries/batch' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        batchBodies.push(body);
        return jsonResponse([], 201);
      }
      if (path === '/api/time-entries' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        return jsonResponse({ id: 'te-new', ...body }, 201);
      }
      if (path === '/api/time-entries') return jsonResponse([]);
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(props: Partial<React.ComponentProps<typeof LogHoursForm>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LogHoursForm employeeId="emp-1" onSubmit={() => {}} onCancel={() => {}} {...props} />
      <Toaster />
    </QueryClientProvider>,
  );
}

/** Pick St. Luke's and wait for its visit types to render. */
async function chooseStLukes(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the client list itself, not just the empty <select>.
  await waitFor(() =>
    expect(screen.getByTestId('select-client-st-lukes')).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByTestId('select-client'), 'st-lukes');
  await waitFor(() => expect(screen.getByTestId('select-visit-type-eval')).toBeInTheDocument());
}

describe('logging more than one of the same visit in a day', () => {
  it('submits two evals and a discharge as two lines with counts', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);

    // Tapping Eval twice is two evals, not an on/off toggle.
    await user.click(screen.getByTestId('select-visit-type-eval'));
    await user.click(screen.getByTestId('select-visit-type-eval'));
    await user.click(screen.getByTestId('select-visit-type-discharge'));

    expect(screen.getByTestId('visit-quantity-eval')).toHaveTextContent('2 visits');
    expect(screen.getByTestId('visit-quantity-discharge')).toHaveTextContent('1 visit');
    expect(screen.getByTestId('button-submit')).toHaveTextContent('Submit 3 Visits');

    await user.click(screen.getByTestId('button-submit'));
    await waitFor(() => expect(batchBodies).toHaveLength(1));
    expect(batchBodies[0]!.visits).toEqual([
      { visitType: 'eval', quantity: 2 },
      { visitType: 'discharge', quantity: 1 },
    ]);
  });

  it('can take one back off without clearing the line', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);

    await user.click(screen.getByTestId('select-visit-type-eval'));
    await user.click(screen.getByTestId('select-visit-type-eval'));
    await user.click(screen.getByTestId('visit-minus-eval'));
    expect(screen.getByTestId('visit-quantity-eval')).toHaveTextContent('1 visit');

    // Going below one removes the line entirely.
    await user.click(screen.getByTestId('visit-minus-eval'));
    expect(screen.queryByTestId('visit-line-eval')).not.toBeInTheDocument();
  });
});

describe('visit types billed in 15-minute blocks', () => {
  it('shows the count as a duration and sends the number of blocks', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);

    await user.click(screen.getByTestId('select-visit-type-hospital-at-home'));
    expect(screen.getByTestId('visit-quantity-hospital-at-home')).toHaveTextContent('15 min');
    await user.click(screen.getByTestId('visit-plus-hospital-at-home'));
    // A half hour, which is what the employee actually knows.
    expect(screen.getByTestId('visit-quantity-hospital-at-home')).toHaveTextContent('30 min');

    await user.click(screen.getByTestId('button-submit'));
    await waitFor(() => expect(batchBodies).toHaveLength(1));
    expect(batchBodies[0]!.visits).toEqual([{ visitType: 'hospital-at-home', quantity: 2 }]);
  });

  it('rolls a longer stay up into hours', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);

    await user.click(screen.getByTestId('select-visit-type-hospital-at-home'));
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByTestId('visit-plus-hospital-at-home'));
    }
    expect(screen.getByTestId('visit-quantity-hospital-at-home')).toHaveTextContent('1 hr 15 min');
  });
});

describe('visit types narrowed to the employee’s discipline', () => {
  it('offers an RN nursing visits and not the PT one', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);

    expect(screen.getByTestId('select-visit-type-skilled-nursing')).toBeInTheDocument();
    expect(screen.queryByTestId('select-visit-type-physical-therapy')).not.toBeInTheDocument();
    // Visits every discipline performs stay on the list.
    expect(screen.getByTestId('select-visit-type-eval')).toBeInTheDocument();
    expect(screen.getByTestId('text-discipline-scope')).toHaveTextContent(
      'Showing the visit types for RN',
    );
  });

  it('offers a PT the therapy visit and not the nursing one', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'PT' });
    await chooseStLukes(user);

    expect(screen.getByTestId('select-visit-type-physical-therapy')).toBeInTheDocument();
    expect(screen.queryByTestId('select-visit-type-skilled-nursing')).not.toBeInTheDocument();
  });

  it('shows everything when the discipline is unknown, rather than nothing', async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseStLukes(user);

    expect(screen.getByTestId('select-visit-type-skilled-nursing')).toBeInTheDocument();
    expect(screen.getByTestId('select-visit-type-physical-therapy')).toBeInTheDocument();
    expect(screen.queryByTestId('text-discipline-scope')).not.toBeInTheDocument();
  });
});

describe('mileage for a date range', () => {
  it('offers the range only once the entry is mileage on its own', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);

    // On the Visit tab there is nothing to spread across a range.
    await user.click(screen.getByTestId('switch-mileage'));
    await user.type(screen.getByTestId('input-mileage'), '210');
    expect(screen.queryByTestId('switch-mileage-range')).not.toBeInTheDocument();

    // Hourly with no clock times is a mileage-only entry.
    await user.click(screen.getByTestId('tab-hourly'));
    await waitFor(() =>
      expect(screen.getByTestId('switch-mileage-range')).toBeInTheDocument(),
    );
  });

  it('submits one entry covering the whole period', async () => {
    const user = userEvent.setup();
    renderForm({ discipline: 'RN' });
    await chooseStLukes(user);
    await user.click(screen.getByTestId('tab-hourly'));

    await user.click(screen.getByTestId('switch-mileage'));
    await user.type(screen.getByTestId('input-mileage'), '210');
    await user.click(screen.getByTestId('switch-mileage-range'));
    const endDate = screen.getByTestId('input-mileage-end-date');
    await user.clear(endDate);
    await user.type(endDate, '2029-06-24');

    await user.click(screen.getByTestId('button-submit'));
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toMatchObject({ mileage: 210, endDate: '2029-06-24' });
    // No clock times — the whole point is that there is no single shift.
    expect(postBodies[0]).not.toHaveProperty('timeIn');
  });
});
