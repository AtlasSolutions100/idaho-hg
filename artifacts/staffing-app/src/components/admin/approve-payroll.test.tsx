import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovePayrollTable, mondayOf, weekLabel } from './approve-payroll-table';

// Verifies the payroll approval list groups waiting entries by week, newest
// week first, using the real generated hooks against a stubbed network layer.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseEntry = {
  employeeRole: 'RN',
  status: 'submitted',
  isDemo: false,
  isWeekend: false,
  isHoliday: false,
};

// Aug 2026: the 3rd is a Monday. Entries span two different weeks.
const ENTRIES = [
  { ...baseEntry, id: 'e-1', employeeId: 'emp-1', employeeName: 'Casey Demo', clientId: 'c-1', clientName: 'Clinic A', date: '2026-08-05', hours: 8 },
  { ...baseEntry, id: 'e-2', employeeId: 'emp-2', employeeName: 'Jordan Demo', clientId: 'c-1', clientName: 'Clinic A', date: '2026-07-29', hours: 6 },
  { ...baseEntry, id: 'e-3', employeeId: 'emp-1', employeeName: 'Casey Demo', clientId: 'c-2', clientName: 'Clinic B', date: '2026-08-04', hours: 4 },
  // Approved entries must not appear at all.
  { ...baseEntry, id: 'e-4', employeeId: 'emp-1', employeeName: 'Casey Demo', clientId: 'c-2', clientName: 'Clinic B', date: '2026-08-03', hours: 4, status: 'approved' },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/time-entries') return jsonResponse(ENTRIES);
      return jsonResponse({ message: `Unexpected request: ${path}` }, 500);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApprovePayrollTable />
    </QueryClientProvider>,
  );
}

describe('week helpers', () => {
  it('finds the Monday of any date, including Sundays', () => {
    expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // Wednesday
    expect(mondayOf('2026-08-03')).toBe('2026-08-03'); // Monday itself
    expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // Sunday belongs to prior Monday
  });

  it('labels a week in plain language', () => {
    expect(weekLabel('2026-08-03')).toBe('Week of Aug 3, 2026');
  });
});

describe('ApprovePayrollTable', () => {
  it('groups waiting entries by week, newest week first', async () => {
    renderTable();
    const currentWeek = await screen.findByTestId('week-heading-2026-08-03');
    const priorWeek = screen.getByTestId('week-heading-2026-07-27');
    expect(currentWeek.textContent).toBe('Week of Aug 3, 2026');
    expect(priorWeek.textContent).toBe('Week of Jul 27, 2026');
    // Newest week renders above the older one.
    expect(
      currentWeek.compareDocumentPosition(priorWeek) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Only submitted entries are listed.
    expect(screen.getByTestId('payroll-entry-e-1')).toBeTruthy();
    expect(screen.getByTestId('payroll-entry-e-2')).toBeTruthy();
    expect(screen.getByTestId('payroll-entry-e-3')).toBeTruthy();
    expect(screen.queryByTestId('payroll-entry-e-4')).toBeNull();
  });

  it('says how many entries approve-all covers', async () => {
    renderTable();
    const button = await screen.findByTestId('button-approve-all');
    expect(button.textContent).toContain('Approve all 3 waiting');
  });
});
