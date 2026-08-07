import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovePayrollTable } from './approve-payroll-table';
import { Toaster } from '@/components/ui/toaster';

// End-to-end UI coverage of Molly's fix-and-approve flow: open a submitted
// entry's detail, click "Fix this entry", edit a field, save, and confirm
// the PATCH payload and success toast — using the real generated hooks
// against a stubbed network layer.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const HOURLY_ENTRY = {
  id: 'te-1',
  employeeId: 'emp-1',
  employeeName: 'Casey Demo',
  employeeRole: 'RN',
  clientId: 'c-1',
  clientName: 'Willow Creek Home Health',
  date: '2026-08-05',
  timeIn: '09:00',
  timeOut: '13:30',
  hours: 4.5,
  mileage: 12,
  note: 'Morning shift',
  status: 'submitted',
  isDemo: false,
  isWeekend: false,
  isHoliday: false,
  submittedAt: '2026-08-06T15:30:00Z',
};

let patchRequests: { id: string; body: Record<string, unknown> }[];
let approvedIds: string[];
let listEntries: unknown[];

beforeEach(() => {
  patchRequests = [];
  approvedIds = [];
  listEntries = [HOURLY_ENTRY];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/time-entries' && (!init?.method || init.method === 'GET')) {
        return jsonResponse(listEntries);
      }
      const patchMatch = /^\/api\/time-entries\/([^/]+)$/.exec(path);
      if (patchMatch && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchRequests.push({ id: patchMatch[1]!, body });
        const updated = { ...HOURLY_ENTRY, ...body, adminEditedAt: '2026-08-07T10:00:00Z' };
        // The list refetch after the save must return the corrected entry.
        listEntries = [updated];
        return jsonResponse(updated);
      }
      const approveMatch = /^\/api\/time-entries\/([^/]+)\/approve$/.exec(path);
      if (approveMatch && init?.method === 'POST') {
        approvedIds.push(approveMatch[1]!);
        const approved = { ...(listEntries[0] as object), status: 'approved' };
        listEntries = [approved];
        return jsonResponse(approved);
      }
      return jsonResponse({ message: `Unexpected request: ${init?.method ?? 'GET'} ${path}` }, 500);
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
      <ApprovePayrollTable />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('ApprovePayrollTable — fix-and-approve flow', () => {
  it('opens the detail, fixes a field, saves the PATCH, and shows the success toast', async () => {
    const user = userEvent.setup();
    renderTable();

    // Open the day detail for the submitted entry.
    fireEvent.click(await screen.findByTestId('button-expand-te-1'));
    expect(screen.getByTestId('entry-detail-te-1')).toBeTruthy();

    // Enter fix mode; the form is prefilled from the entry.
    await user.click(screen.getByTestId('button-fix-entry-te-1'));
    expect(screen.getByTestId('admin-edit-form-te-1')).toBeTruthy();
    expect(screen.getByTestId('input-time-in-te-1')).toHaveValue('09:00');
    expect(screen.getByTestId('input-time-out-te-1')).toHaveValue('13:30');
    expect(screen.getByTestId('input-mileage-te-1')).toHaveValue(12);
    expect(screen.getByTestId('input-note-te-1')).toHaveValue('Morning shift');

    // Molly fixes the clock-out time and the mileage.
    fireEvent.change(screen.getByTestId('input-time-out-te-1'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByTestId('input-mileage-te-1'), { target: { value: '20' } });
    await user.click(screen.getByTestId('button-save-edit-te-1'));

    // The PATCH carries the corrected fields (and never invents hours when
    // clock times are present — the server derives them).
    await waitFor(() => expect(patchRequests.length).toBe(1));
    expect(patchRequests[0]!.id).toBe('te-1');
    expect(patchRequests[0]!.body).toMatchObject({
      clientId: 'c-1',
      date: '2026-08-05',
      timeIn: '09:00',
      timeOut: '14:00',
      mileage: 20,
      note: 'Morning shift',
    });
    expect(patchRequests[0]!.body).not.toHaveProperty('hours');

    // Success toast tells Molly the employee will see the change.
    await waitFor(() => expect(screen.getByText('Entry updated')).toBeTruthy());
    expect(screen.getByText('Casey Demo will see what you changed.')).toBeTruthy();

    // The form closes back to the read-only detail, which now shows the
    // corrected entry with the admin-edit marker after the list refetch.
    expect(screen.queryByTestId('admin-edit-form-te-1')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('detail-admin-edit-te-1')).toBeTruthy(),
    );

    // Molly then approves the corrected entry from the same row.
    await user.click(screen.getByTestId('button-approve-te-1'));
    await waitFor(() => expect(approvedIds).toEqual(['te-1']));
    await waitFor(() => expect(screen.getByText('Entry approved')).toBeTruthy());
    // Once approved, the entry leaves the waiting list.
    await waitFor(() => expect(screen.queryByTestId('payroll-entry-te-1')).toBeNull());
  });

  it('cancel closes the form without any PATCH', async () => {
    const user = userEvent.setup();
    renderTable();
    fireEvent.click(await screen.findByTestId('button-expand-te-1'));
    await user.click(screen.getByTestId('button-fix-entry-te-1'));
    await user.click(screen.getByTestId('button-cancel-edit-te-1'));
    expect(screen.queryByTestId('admin-edit-form-te-1')).toBeNull();
    expect(patchRequests.length).toBe(0);
    // The detail is still open for review.
    expect(screen.getByTestId('button-fix-entry-te-1')).toBeTruthy();
  });

  it('surfaces the server message in a destructive toast when the save fails', async () => {
    const user = userEvent.setup();
    renderTable();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const original = fetchMock.getMockImplementation()! as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return jsonResponse({ message: 'Clock-out must be after clock-in.' }, 400);
      }
      return original(input, init);
    });

    fireEvent.click(await screen.findByTestId('button-expand-te-1'));
    await user.click(screen.getByTestId('button-fix-entry-te-1'));
    fireEvent.change(screen.getByTestId('input-time-out-te-1'), { target: { value: '08:00' } });
    await user.click(screen.getByTestId('button-save-edit-te-1'));

    await waitFor(() => expect(screen.getByText("Couldn't save changes")).toBeTruthy());
    expect(screen.getByText('Clock-out must be after clock-in.')).toBeTruthy();
    // The form stays open so Molly can correct it.
    expect(screen.getByTestId('admin-edit-form-te-1')).toBeTruthy();
  });
});
