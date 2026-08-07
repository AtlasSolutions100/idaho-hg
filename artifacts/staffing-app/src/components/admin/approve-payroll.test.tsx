import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovePayrollTable, mondayOf, weekLabel, daySummary } from './approve-payroll-table';

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
  submittedAt: '2026-08-06T15:30:00Z',
};

// Aug 2026: the 3rd is a Monday. Entries span two different weeks.
const ENTRIES = [
  { ...baseEntry, id: 'e-1', employeeId: 'emp-1', employeeName: 'Casey Demo', clientId: 'c-1', clientName: 'Clinic A', date: '2026-08-05', hours: 8 },
  { ...baseEntry, id: 'e-2', employeeId: 'emp-2', employeeName: 'Jordan Demo', clientId: 'c-1', clientName: 'Clinic A', date: '2026-07-29', hours: 6 },
  { ...baseEntry, id: 'e-3', employeeId: 'emp-1', employeeName: 'Casey Demo', clientId: 'c-2', clientName: 'Clinic B', date: '2026-08-04', hours: 4 },
  // Approved entries must not appear at all.
  { ...baseEntry, id: 'e-4', employeeId: 'emp-1', employeeName: 'Casey Demo', clientId: 'c-2', clientName: 'Clinic B', date: '2026-08-03', hours: 4, status: 'approved' },
  // A multi-visit St. Luke's day: three entries, same employee/client/date.
  // Mileage, per diem, and the note live on the first entry only.
  { ...baseEntry, id: 'sl-1', employeeId: 'emp-3', employeeName: 'Robin Demo', clientId: 'c-sl', clientName: "St. Luke's", date: '2026-08-06', visitType: 'soc', mileage: 42, perDiemType: 'full', perDiem: 1, note: 'Long drive to Weiser' },
  { ...baseEntry, id: 'sl-2', employeeId: 'emp-3', employeeName: 'Robin Demo', clientId: 'c-sl', clientName: "St. Luke's", date: '2026-08-06', visitType: 'routine-visit' },
  { ...baseEntry, id: 'sl-3', employeeId: 'emp-3', employeeName: 'Robin Demo', clientId: 'c-sl', clientName: "St. Luke's", date: '2026-08-06', visitType: 'routine-visit' },
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
    expect(button.textContent).toContain('Approve all 6 waiting');
  });

  it('expands a row to show the full day detail, and collapses it again', async () => {
    renderTable();
    const expandButton = await screen.findByTestId('button-expand-sl-1');
    expect(screen.queryByTestId('entry-detail-sl-1')).toBeNull();

    fireEvent.click(expandButton);
    const detail = screen.getByTestId('entry-detail-sl-1');
    expect(detail).toBeTruthy();

    // Multi-visit day: every visit type with its count.
    const visits = screen.getByTestId('detail-visits-sl-1').textContent!;
    expect(visits).toContain('1 × Start of Care (SOC)');
    expect(visits).toContain('2 × Routine Visit');

    // Daily mileage and per diem shown once for the day.
    expect(screen.getByTestId('detail-mileage-sl-1').textContent).toBe('42 miles');
    expect(screen.getByTestId('detail-perdiem-sl-1').textContent).toBe('Full day');

    // Full note, untruncated.
    expect(screen.getByTestId('detail-note-sl-1').textContent).toBe('Long drive to Weiser');

    // Day flags aggregate across siblings (regular weekday here).
    expect(screen.getByTestId('detail-flags-sl-1').textContent).toBe('Regular weekday');

    fireEvent.click(expandButton);
    expect(screen.queryByTestId('entry-detail-sl-1')).toBeNull();
  });

  it('sibling visit rows report the same day totals (mileage never repeated per visit)', async () => {
    renderTable();
    fireEvent.click(await screen.findByTestId('button-expand-sl-2'));
    // The second visit row carries no mileage itself, but the day summary does.
    expect(screen.getByTestId('detail-mileage-sl-2').textContent).toBe('42 miles');
    expect(screen.getByTestId('detail-perdiem-sl-2').textContent).toBe('Full day');
  });

  it('approve still works from an expanded row', async () => {
    renderTable();
    fireEvent.click(await screen.findByTestId('button-expand-e-1'));
    expect(screen.getByTestId('entry-detail-e-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-approve-e-1'));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find(([input]) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        return url.includes('/time-entries/e-1/approve');
      });
      expect(approveCall).toBeTruthy();
    });
  });
});

describe('daySummary', () => {
  const all = ENTRIES as never[];
  it('collects visit counts, day mileage, and per diem across sibling entries', () => {
    const day = daySummary(ENTRIES[4] as never, all);
    expect(day.totalVisits).toBe(3);
    expect(day.visitCounts).toEqual([
      ['Start of Care (SOC)', 1],
      ['Routine Visit', 2],
    ]);
    expect(day.mileage).toBe(42);
    expect(day.perDiemType).toBe('full');
    expect(day.notes).toEqual(['Long drive to Weiser']);
    expect(day.isWeekend).toBe(false);
    expect(day.isHoliday).toBe(false);
  });

  it('aggregates weekend/holiday flags and excludes drafts from the day', () => {
    const siblings = [
      { ...ENTRIES[4], isWeekend: true },
      { ...ENTRIES[5] },
      // A draft sibling must never leak into the day summary.
      { ...ENTRIES[6], status: 'draft', mileage: 99 },
    ];
    const day = daySummary(siblings[0] as never, siblings as never[]);
    expect(day.isWeekend).toBe(true);
    expect(day.isHoliday).toBe(false);
    expect(day.totalVisits).toBe(2);
    expect(day.mileage).toBe(42);
  });

  it('surfaces legacy numeric per diem entries with no type', () => {
    const legacy = [
      { ...ENTRIES[0], perDiem: 1.5, perDiemType: undefined },
    ];
    const day = daySummary(legacy[0] as never, legacy as never[]);
    expect(day.perDiemType).toBeUndefined();
    expect(day.perDiemCount).toBe(1.5);
  });

  it('excludes rejected siblings but keeps approved ones', () => {
    const siblings = [
      // The resubmitted entry Molly is looking at.
      { ...ENTRIES[4] },
      // A sibling she already approved still counts toward the day.
      { ...ENTRIES[5], status: 'approved' },
      // A rejected leftover must not pollute the day with stale data.
      { ...ENTRIES[6], status: 'rejected', mileage: 77, note: 'old wrong note', isHoliday: true },
    ];
    const day = daySummary(siblings[0] as never, siblings as never[]);
    expect(day.totalVisits).toBe(2);
    expect(day.mileage).toBe(42);
    expect(day.notes).toEqual(['Long drive to Weiser']);
    expect(day.isHoliday).toBe(false);
  });

  it('a plain hourly entry is its own day', () => {
    const day = daySummary(ENTRIES[0] as never, all);
    expect(day.totalVisits).toBe(0);
    expect(day.mileage).toBe(0);
    expect(day.perDiemType).toBeUndefined();
  });
});
