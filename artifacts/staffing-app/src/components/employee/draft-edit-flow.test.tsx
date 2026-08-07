import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TimeEntry } from '@workspace/api-client-react';
import { LogHoursForm } from './log-hours-form';
import { TimeEntriesList } from './time-entries-list';
import { Toaster } from '@/components/ui/toaster';

// End-to-end UI coverage of the draft/edit flow with real generated hooks
// against a stubbed network layer: save as draft, draft badge, prefilled
// edit, Save & Resubmit, and the lock on approved entries.

const CLIENTS = [
  {
    id: 'c1',
    name: 'Willow Creek Home Health',
    mileageOnContract: true,
    billsByVisitType: false,
  },
];

const DRAFT_ENTRY: TimeEntry = {
  id: 'te-draft',
  employeeId: 'emp-1',
  clientId: 'c1',
  clientName: 'Willow Creek Home Health',
  date: '2026-08-03',
  timeIn: '09:00',
  timeOut: '13:30',
  hours: 4.5,
  status: 'draft',
  note: 'Morning shift',
} as TimeEntry;

const SUBMITTED_ENTRY: TimeEntry = {
  ...DRAFT_ENTRY,
  id: 'te-submitted',
  status: 'submitted',
} as TimeEntry;

const APPROVED_ENTRY: TimeEntry = {
  ...DRAFT_ENTRY,
  id: 'te-approved',
  status: 'approved',
} as TimeEntry;

let postBodies: unknown[];
let patchRequests: { id: string; body: Record<string, unknown> }[];
let listEntries: TimeEntry[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  postBodies = [];
  patchRequests = [];
  listEntries = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/clients') return jsonResponse(CLIENTS);
      if (path === '/api/time-entries' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        return jsonResponse({ ...DRAFT_ENTRY, id: 'te-new', ...body }, 201);
      }
      if (path === '/api/time-entries') return jsonResponse(listEntries);
      const patchMatch = /^\/api\/time-entries\/([^/]+)$/.exec(path);
      if (patchMatch && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchRequests.push({ id: patchMatch[1]!, body });
        return jsonResponse({ ...DRAFT_ENTRY, id: patchMatch[1], ...body });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('LogHoursForm — save as draft', () => {
  it('shows the Save as draft button only when drafts are allowed', async () => {
    renderWithClient(
      <LogHoursForm employeeId="emp-1" onSubmit={() => {}} onCancel={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('button-save-draft')).not.toBeInTheDocument();

    cleanup();
    renderWithClient(
      <LogHoursForm employeeId="emp-1" allowDraft onSubmit={() => {}} onCancel={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('button-save-draft')).toHaveTextContent('Save as draft');
  });

  it('saves a new entry as a draft with status "draft"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithClient(
      <LogHoursForm employeeId="emp-1" allowDraft onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByTestId('select-client'), 'c1');
    fireEvent.change(screen.getByTestId('input-time-in'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByTestId('input-time-out'), { target: { value: '13:30' } });
    await user.click(screen.getByTestId('button-save-draft'));

    await waitFor(() => expect(postBodies.length).toBe(1));
    expect(postBodies[0]).toMatchObject({
      employeeId: 'emp-1',
      clientId: 'c1',
      timeIn: '09:00',
      timeOut: '13:30',
      status: 'draft',
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(true));
  });

  it('submits (not drafts) when the main button is used', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithClient(
      <LogHoursForm employeeId="emp-1" allowDraft onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByTestId('select-client'), 'c1');
    fireEvent.change(screen.getByTestId('input-time-in'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByTestId('input-time-out'), { target: { value: '13:30' } });
    await user.click(screen.getByTestId('button-submit'));

    await waitFor(() => expect(postBodies.length).toBe(1));
    // No status field means the server defaults to "submitted".
    expect(postBodies[0]).not.toHaveProperty('status');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(false));
  });
});

describe('TimeEntriesList — badges, edit, and the approved lock', () => {
  it('shows a Draft badge for draft entries', async () => {
    listEntries = [DRAFT_ENTRY, SUBMITTED_ENTRY];
    renderWithClient(<TimeEntriesList employeeId="emp-1" onEdit={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('status-te-draft')).toHaveTextContent('Draft'),
    );
    expect(screen.getByTestId('status-te-submitted')).toHaveTextContent(
      'Waiting for approval',
    );
  });

  it('offers Edit for unapproved entries and passes the entry to onEdit', async () => {
    listEntries = [DRAFT_ENTRY];
    const onEdit = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<TimeEntriesList employeeId="emp-1" onEdit={onEdit} />);
    await waitFor(() =>
      expect(screen.getByTestId('button-edit-te-draft')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('button-edit-te-draft'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'te-draft' }));
  });

  it('locks approved entries: no Edit button, lock indicator instead', async () => {
    listEntries = [APPROVED_ENTRY, DRAFT_ENTRY];
    renderWithClient(<TimeEntriesList employeeId="emp-1" onEdit={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('status-te-approved')).toHaveTextContent('Approved'),
    );
    expect(screen.queryByTestId('button-edit-te-approved')).not.toBeInTheDocument();
    expect(screen.getByTestId('locked-te-approved')).toBeInTheDocument();
    // The draft next to it is still editable.
    expect(screen.getByTestId('button-edit-te-draft')).toBeInTheDocument();
  });
});

describe('LogHoursForm — editing an existing entry', () => {
  it('opens a draft prefilled and updates it instead of creating a new entry', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithClient(
      <LogHoursForm
        employeeId="emp-1"
        entry={DRAFT_ENTRY}
        allowDraft
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );

    expect(screen.getByText('Edit Entry')).toBeInTheDocument();
    expect(screen.getByTestId('select-client')).toHaveValue('c1');
    expect(screen.getByTestId('input-date')).toHaveValue('2026-08-03');
    expect(screen.getByTestId('input-time-in')).toHaveValue('09:00');
    expect(screen.getByTestId('input-time-out')).toHaveValue('13:30');
    expect(screen.getByTestId('input-note')).toHaveValue('Morning shift');
    // Re-saving a draft as a draft stays a draft.
    await user.click(screen.getByTestId('button-save-draft'));
    await waitFor(() => expect(patchRequests.length).toBe(1));
    expect(patchRequests[0]!.id).toBe('te-draft');
    expect(patchRequests[0]!.body).toMatchObject({ status: 'draft' });
    expect(postBodies.length).toBe(0); // never falls back to creating
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(true));
  });

  it('submitting a draft turns it into a submitted entry', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <LogHoursForm
        employeeId="emp-1"
        entry={DRAFT_ENTRY}
        allowDraft
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('button-submit')).toHaveTextContent('Submit Hours');
    await user.click(screen.getByTestId('button-submit'));
    await waitFor(() => expect(patchRequests.length).toBe(1));
    expect(patchRequests[0]!.id).toBe('te-draft');
    expect(patchRequests[0]!.body).toMatchObject({ status: 'submitted' });
    expect(postBodies.length).toBe(0);
  });

  it('editing a submitted entry shows Save & Resubmit and no draft button', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <LogHoursForm
        employeeId="emp-1"
        entry={SUBMITTED_ENTRY}
        allowDraft
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Willow Creek Home Health')).toBeInTheDocument(),
    );

    // A submitted entry can't go back to draft from here.
    expect(screen.queryByTestId('button-save-draft')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-submit')).toHaveTextContent('Save & Resubmit');

    fireEvent.change(screen.getByTestId('input-time-out'), { target: { value: '14:00' } });
    await user.click(screen.getByTestId('button-submit'));
    await waitFor(() => expect(patchRequests.length).toBe(1));
    expect(patchRequests[0]!.id).toBe('te-submitted');
    expect(patchRequests[0]!.body).toMatchObject({
      timeOut: '14:00',
      status: 'submitted',
    });
    expect(postBodies.length).toBe(0);
  });
});
