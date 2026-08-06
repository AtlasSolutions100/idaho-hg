import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickBooksCard } from './quickbooks-card';

// The QuickBooks card must show the exact callback address to register in the
// Intuit portal, and explain itself when a connect attempt never came back.

const STATUS = {
  configured: true,
  connected: false,
  companyName: null,
  connectedAt: null,
  problem: null,
  callbackUrl: 'https://example.replit.dev/api/qbo/callback',
};

let status: Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  status = { ...STATUS };
  sessionStorage.clear();
  window.history.replaceState(null, '', '/admin');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.split('?')[0];
      if (path === '/api/qbo/status') return jsonResponse(status);
      return jsonResponse({ message: `Unexpected request: ${path}` }, 500);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuickBooksCard />
    </QueryClientProvider>,
  );
}

describe('QuickBooksCard', () => {
  it('shows the exact callback address to register, with a copy button', async () => {
    renderCard();
    const address = await screen.findByTestId('text-qbo-callback-url');
    expect(address.textContent).toBe(STATUS.callbackUrl);
    expect(screen.getByTestId('button-qbo-copy-callback')).toBeTruthy();
    // Mentions the silently-failing Intuit save.
    expect(screen.getByTestId('section-qbo-callback').textContent).toContain('fails quietly');
  });

  it('hides the address section once connected', async () => {
    status = { ...STATUS, connected: true, companyName: 'Idaho Healthcare Staffing' };
    renderCard();
    await screen.findByTestId('badge-qbo-connected');
    expect(screen.queryByTestId('section-qbo-callback')).toBeNull();
  });

  it('explains when a recent connect attempt never came back', async () => {
    sessionStorage.setItem('qbo-connect-attempt', String(Date.now()));
    renderCard();
    const alert = await screen.findByTestId('alert-qbo-never-returned');
    expect(alert.textContent).toContain("didn't finish");
    expect(alert.textContent).toContain('Redirect URIs');
    expect(alert.textContent).toContain('one tab');
    // The reminder is one-shot — it shouldn't survive to the next page load.
    expect(sessionStorage.getItem('qbo-connect-attempt')).toBeNull();
  });

  it('clears a stale attempt flag quietly without warning', async () => {
    sessionStorage.setItem('qbo-connect-attempt', String(Date.now() - 60 * 60 * 1000));
    renderCard();
    await screen.findByTestId('badge-qbo-not-connected');
    expect(screen.queryByTestId('alert-qbo-never-returned')).toBeNull();
    expect(sessionStorage.getItem('qbo-connect-attempt')).toBeNull();
  });

  it('does not warn when the attempt actually completed with a result', async () => {
    sessionStorage.setItem('qbo-connect-attempt', String(Date.now()));
    window.history.replaceState(null, '', '/admin?quickbooks=cancelled');
    renderCard();
    await screen.findByTestId('alert-qbo-connect-cancelled');
    expect(screen.queryByTestId('alert-qbo-never-returned')).toBeNull();
    expect(sessionStorage.getItem('qbo-connect-attempt')).toBeNull();
  });

  it('shows no warning without a pending connect attempt', async () => {
    renderCard();
    await screen.findByTestId('badge-qbo-not-connected');
    expect(screen.queryByTestId('alert-qbo-never-returned')).toBeNull();
  });
});
