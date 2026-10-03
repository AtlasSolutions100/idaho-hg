import { Link } from 'wouter';
import { useListClients, useListClientRates } from '@workspace/api-client-react';
import { AlertTriangle } from 'lucide-react';
import { LoadFailure } from '@/components/load-failure';

// Heads-up shown above the report cards: lists active clients that have no
// billing rates on file at all. Any invoice generated for these clients would
// bill every line at $0, so Molly can fix rates before running month-end.
export function MissingRatesNotice() {
  const clientsQuery = useListClients();
  const ratesQuery = useListClientRates();
  const clients = clientsQuery.data;
  const rates = ratesQuery.data;

  // Rendering nothing when the check itself failed reads as "every client has
  // rates" — the exact opposite of what is known — and this notice is the
  // last thing standing between Molly and an invoice that bills every line at
  // $0. Say the check didn't run instead.
  if (clientsQuery.isError || ratesQuery.isError) {
    return (
      <LoadFailure
        what="the billing-rate check"
        error={clientsQuery.error ?? ratesQuery.error}
        onRetry={() => {
          void clientsQuery.refetch();
          void ratesQuery.refetch();
        }}
        testId="missing-rates-check-failed"
      />
    );
  }

  if (!clients || !rates) return null;

  const clientIdsWithRates = new Set(rates.map((r) => r.clientId));
  const missing = clients.filter((c) => !clientIdsWithRates.has(c.id));

  if (missing.length === 0) return null;

  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3"
      data-testid="missing-rates-notice"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {missing.length === 1 ? 'A client has' : `${missing.length} clients have`} no billing
          rates on file
        </p>
        <p className="text-amber-700 dark:text-amber-400 mt-0.5">
          {missing.map((c) => c.name).join(', ')} — invoices for{' '}
          {missing.length === 1 ? 'this client' : 'these clients'} would bill every line at $0.{' '}
          <Link href="/admin/client-rates" className="underline font-medium">
            Add rates on the Client Rates page
          </Link>
        </p>
      </div>
    </div>
  );
}
