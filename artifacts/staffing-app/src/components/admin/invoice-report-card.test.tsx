import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceReportCard } from './invoice-report-card';

// These tests exercise the real generated API hooks (react-query) against a
// stubbed network layer, so the query-invalidation path after a successful
// "Send to QuickBooks" runs exactly as it does in the app.

const CLIENT = { id: 'client-1', name: 'Idaho Youth Ranch', active: true, isDemo: false };

const REPORT = {
  clientId: 'client-1',
  clientName: 'Idaho Youth Ranch',
  start: '2026-07-12',
  end: '2026-07-25',
  lines: [
    {
      lineId: 'line-1',
      date: '2026-07-13',
      productService: 'Skilled Nursing Visit',
      description: 'SN visit — J. Smith',
      qty: 1,
      rate: 120,
      amount: 120,
      kind: 'visit',
      missingRate: false,
    },
  ],
  total: 120,
  entryCount: 1,
  missingRateCount: 0,
  unbilledCount: 0,
};

const NOT_SENT = { sent: false, sentAt: null, docNumber: null, qboInvoiceId: null };
const SENT = {
  sent: true,
  sentAt: '2026-07-28T17:30:00.000Z',
  docNumber: '1042',
  qboInvoiceId: 'qbo-77',
};

type Routes = {
  sentInvoices: () => unknown;
  onSend?: () => { status: number; body: unknown };
};

let routes: Routes;
let sentLookupCalls: string[];
let sendRequestBodies: unknown[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  sentLookupCalls = [];
  sendRequestBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/clients') return jsonResponse([CLIENT]);
      if (path === '/api/business-settings')
        return jsonResponse({
          address: '123 Main St',
          phone: '208-555-0100',
          email: 'molly@example.com',
          paymentTerms: 'Net 30',
          nextInvoiceNumber: 1,
        });
      if (path === '/api/time-entries') return jsonResponse([]);
      if (path === '/api/qbo/status')
        return jsonResponse({ configured: true, connected: true });
      if (path === '/api/reports/invoice') return jsonResponse(REPORT);
      if (path === '/api/qbo/sent-invoices') {
        sentLookupCalls.push(url);
        return jsonResponse(routes.sentInvoices());
      }
      if (path === '/api/qbo/invoice' && (init?.method ?? 'GET') === 'POST') {
        sendRequestBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
        const result = routes.onSend?.() ?? { status: 500, body: { message: 'no send stub' } };
        return jsonResponse(result.body, result.status);
      }
      throw new Error(`Unstubbed request in test: ${init?.method ?? 'GET'} ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InvoiceReportCard />
    </QueryClientProvider>,
  );
}

// Fill the period inputs and generate the report for CLIENT. The client
// <Select> is a Radix listbox, so we pick the option through the keyboard.
async function generateReport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('select-invoice-client'));
  await user.click(await screen.findByRole('option', { name: /Idaho Youth Ranch/ }));
  await user.type(screen.getByTestId('input-invoice-period-start'), '2026-07-12');
  await user.type(screen.getByTestId('input-invoice-period-end'), '2026-07-25');
  await user.click(screen.getByTestId('button-generate-client-invoice-summary'));
  await screen.findByTestId('invoice-results');
}

describe('InvoiceReportCard — Sent to QuickBooks note', () => {
  it('shows the note with the send date and invoice number when the period was already sent', async () => {
    routes = { sentInvoices: () => SENT };
    const user = userEvent.setup();
    renderCard();

    await generateReport(user);

    const note = await screen.findByTestId('invoice-qbo-already-sent-note');
    expect(note).toHaveTextContent('Sent to QuickBooks on July 28, 2026');
    expect(note).toHaveTextContent('as invoice #1042');
    // The lookup must be scoped to the generated client + period.
    expect(sentLookupCalls.at(-1)).toContain('clientId=client-1');
    expect(sentLookupCalls.at(-1)).toContain('start=2026-07-12');
    expect(sentLookupCalls.at(-1)).toContain('end=2026-07-25');
  });

  it('omits the invoice number when QuickBooks did not assign one', async () => {
    routes = { sentInvoices: () => ({ ...SENT, docNumber: null }) };
    const user = userEvent.setup();
    renderCard();

    await generateReport(user);

    const note = await screen.findByTestId('invoice-qbo-already-sent-note');
    expect(note).toHaveTextContent('Sent to QuickBooks on July 28, 2026');
    expect(note).not.toHaveTextContent('as invoice #');
  });

  it('does not show the note when the lookup says the period was never sent', async () => {
    routes = { sentInvoices: () => NOT_SENT };
    const user = userEvent.setup();
    renderCard();

    await generateReport(user);

    // The lookup for this period has resolved (sent=false) — the note must be absent.
    await waitFor(() => expect(sentLookupCalls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('invoice-qbo-already-sent-note')).not.toBeInTheDocument();
  });

  it('shows the note after a successful send, via query invalidation', async () => {
    // Before the send the lookup says "never sent"; after the send it says
    // "sent". The note may only appear if the successful mutation invalidates
    // and refetches the lookup.
    let sent = false;
    routes = {
      sentInvoices: () => (sent ? SENT : NOT_SENT),
      onSend: () => {
        sent = true;
        return {
          status: 200,
          body: {
            qboInvoiceId: 'qbo-77',
            docNumber: '1042',
            customerName: 'Idaho Youth Ranch',
            lineCount: 1,
            total: 120,
          },
        };
      },
    };
    const user = userEvent.setup();
    renderCard();

    await generateReport(user);
    expect(screen.queryByTestId('invoice-qbo-already-sent-note')).not.toBeInTheDocument();

    const lookupsBeforeSend = sentLookupCalls.length;
    await user.click(screen.getByTestId('button-send-invoice-to-quickbooks'));

    const note = await screen.findByTestId('invoice-qbo-already-sent-note');
    expect(note).toHaveTextContent('Sent to QuickBooks on July 28, 2026');
    expect(note).toHaveTextContent('as invoice #1042');
    // The refreshed note came from a new lookup request, not a stale cache.
    expect(sentLookupCalls.length).toBeGreaterThan(lookupsBeforeSend);
  });
});

describe('InvoiceReportCard — already-sent confirmation dialog', () => {
  const ALREADY_SENT_MESSAGE =
    'This invoice for Idaho Youth Ranch (Jul 12–25, 2026) was already sent to QuickBooks on July 28, 2026 as invoice #1042.';

  // Drive a send that the server rejects with alreadySent, so the dialog opens.
  async function openDuplicateDialog(user: ReturnType<typeof userEvent.setup>) {
    routes = {
      sentInvoices: () => SENT,
      onSend: () => ({
        status: 409,
        body: { alreadySent: true, message: ALREADY_SENT_MESSAGE },
      }),
    };
    renderCard();
    await generateReport(user);
    await user.click(screen.getByTestId('button-send-invoice-to-quickbooks'));
    return await screen.findByTestId('dialog-quickbooks-already-sent');
  }

  it('shows the confirmation dialog with the server message instead of silently resending', async () => {
    const user = userEvent.setup();
    const dialog = await openDuplicateDialog(user);

    expect(dialog).toHaveTextContent('Already sent to QuickBooks');
    expect(dialog).toHaveTextContent(ALREADY_SENT_MESSAGE);
    // Exactly one send happened — the rejected one. No automatic retry.
    expect(sendRequestBodies).toHaveLength(1);
    expect(sendRequestBodies[0]).toEqual({
      clientId: 'client-1',
      start: '2026-07-12',
      end: '2026-07-25',
    });
  });

  it("closes without a second request when Molly clicks Don't send", async () => {
    const user = userEvent.setup();
    await openDuplicateDialog(user);

    await user.click(screen.getByTestId('button-cancel-duplicate-send'));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-quickbooks-already-sent')).not.toBeInTheDocument(),
    );
    // Still only the original rejected send — cancelling never re-sends.
    expect(sendRequestBodies).toHaveLength(1);
  });

  it('resends with confirmDuplicate=true only after Molly clicks Send again', async () => {
    const user = userEvent.setup();
    await openDuplicateDialog(user);

    // From here on the server accepts the confirmed resend.
    routes.onSend = () => ({
      status: 200,
      body: {
        qboInvoiceId: 'qbo-78',
        docNumber: '1043',
        customerName: 'Idaho Youth Ranch',
        lineCount: 1,
        total: 120,
      },
    });
    await user.click(screen.getByTestId('button-confirm-duplicate-send'));

    await waitFor(() => expect(sendRequestBodies).toHaveLength(2));
    expect(sendRequestBodies[1]).toEqual({
      clientId: 'client-1',
      start: '2026-07-12',
      end: '2026-07-25',
      confirmDuplicate: true,
    });
    await waitFor(() =>
      expect(screen.queryByTestId('dialog-quickbooks-already-sent')).not.toBeInTheDocument(),
    );
  });
});
