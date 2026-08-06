import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeRatesTable } from './employee-rates-table';
import { Toaster } from '@/components/ui/toaster';

// Exercises the contact-info part of the employee management table with the
// real generated hooks against a stubbed network layer.

const RATE = {
  id: 'rate-1',
  employeeId: 'emp-1',
  employeeName: 'Jane Doe',
  employeeRole: 'RN',
  hourlyRate: 40,
  visitRate: 70,
  mileageRate: 0.655,
  perDiemRate: 45,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2,
  effectiveDate: '2026-01-01',
};

let employee: Record<string, unknown>;
let contactPatchBodies: unknown[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  employee = {
    id: 'emp-1',
    name: 'Jane Doe',
    role: 'RN',
    active: true,
    isDemo: false,
    signInEnabled: true,
    phone: '(208) 555-0142',
    contactEmail: 'jane@gmail.com',
  };
  contactPatchBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/employee-rates') return jsonResponse([RATE]);
      if (path === '/api/employees') return jsonResponse([employee]);
      if (path === '/api/link-requests') return jsonResponse([]);
      if (path === '/api/employees/emp-1/contact' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        contactPatchBodies.push(body);
        employee = {
          ...employee,
          phone: body.phone || undefined,
          contactEmail: body.contactEmail || undefined,
          address: body.address || undefined,
        };
        return jsonResponse(employee);
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
      <EmployeeRatesTable />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('employee contact info', () => {
  it('shows stored contact details in the table', async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    const cell = screen.getByTestId('contact-info-emp-1');
    expect(cell.textContent).toContain('(208) 555-0142');
    expect(cell.textContent).toContain('jane@gmail.com');
    expect(screen.getByTestId('button-contact-employee-emp-1').textContent).toContain(
      'Edit contact info',
    );
  });

  it('edits contact details through the dialog and saves via the API', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    await user.click(screen.getByTestId('button-contact-employee-emp-1'));
    const phone = screen.getByTestId('input-contact-phone') as HTMLInputElement;
    expect(phone.value).toBe('(208) 555-0142');

    const address = screen.getByTestId('input-contact-address');
    await user.type(address, '123 Main St, Boise');
    await user.click(screen.getByTestId('button-save-contact-info'));

    await waitFor(() => expect(contactPatchBodies.length).toBe(1));
    expect(contactPatchBodies[0]).toMatchObject({
      phone: '(208) 555-0142',
      contactEmail: 'jane@gmail.com',
      address: '123 Main St, Boise',
    });
    // Dialog closes on success.
    await waitFor(() =>
      expect(screen.queryByTestId('input-contact-phone')).not.toBeInTheDocument(),
    );
  });
});
