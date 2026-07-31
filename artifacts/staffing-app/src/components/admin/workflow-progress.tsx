import {
  useListTimeEntries,
  useGetWorkflowStatus,
  useUpdateWorkflowStatus,
  getGetWorkflowStatusQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

export interface ReadyClient {
  clientId: string;
  clientName: string;
  count: number;
}

export interface WorkflowSnapshot {
  isLoading: boolean;
  isError: boolean;
  pendingCount: number;
  approvedCount: number;
  readyClients: ReadyClient[];
}

/**
 * Derives period status from time-entry data.
 * Optionally scoped to a date range (YYYY-MM-DD, inclusive).
 */
export function useWorkflowSnapshot(range?: { start: string; end: string }): WorkflowSnapshot {
  const entriesQuery = useListTimeEntries();
  const all = entriesQuery.data ?? [];
  const entries = range
    ? all.filter((e) => e.date >= range.start && e.date <= range.end)
    : all;

  const pendingCount = entries.filter((e) => e.status === 'submitted').length;
  const approvedEntries = entries.filter((e) => e.status === 'approved');

  const byClient = new Map<string, ReadyClient>();
  for (const e of approvedEntries) {
    const existing = byClient.get(e.clientId);
    if (existing) {
      existing.count += 1;
    } else {
      byClient.set(e.clientId, { clientId: e.clientId, clientName: e.clientName, count: 1 });
    }
  }
  const readyClients = [...byClient.values()].sort((a, b) =>
    a.clientName.localeCompare(b.clientName),
  );

  return {
    isLoading: entriesQuery.isLoading,
    isError: entriesQuery.isError,
    pendingCount,
    approvedCount: approvedEntries.length,
    readyClients,
  };
}

/** Monday of the current week (local time), YYYY-MM-DD — the check-off period key. */
export function currentPeriodKey(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

/** Manual check-offs for the current week. Fresh weeks start unchecked. */
export function useWorkflowCheckoffs() {
  const period = currentPeriodKey();
  const queryClient = useQueryClient();
  const statusQuery = useGetWorkflowStatus({ period });
  const mutation = useUpdateWorkflowStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWorkflowStatusQueryKey({ period }) });
      },
    },
  });

  const exportDone = statusQuery.data?.exportDone ?? false;
  const invoicesDone = statusQuery.data?.invoicesDone ?? false;

  return {
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    exportDone,
    invoicesDone,
    // Partial updates: only the toggled flag is sent, so rapid toggles of
    // both boxes can't overwrite each other with stale values.
    setExportDone: (v: boolean) => mutation.mutate({ data: { period, exportDone: v } }),
    setInvoicesDone: (v: boolean) => mutation.mutate({ data: { period, invoicesDone: v } }),
  };
}

/**
 * The two manual check-offs for the current week. Checking them clears the
 * matching items from the dashboard's "Needs Attention" list. Nothing is gated.
 */
export function WeeklyCheckoffs({
  checkoffs,
  className,
}: {
  checkoffs: ReturnType<typeof useWorkflowCheckoffs>;
  className?: string;
}) {
  return (
    <ul className={cn('space-y-2', className)} data-testid="workflow-progress">
      <li className="flex items-center gap-3 text-sm" data-testid="checklist-export">
        <Checkbox
          id="checkoff-export"
          checked={checkoffs.exportDone}
          onCheckedChange={(v) => checkoffs.setExportDone(v === true)}
          data-testid="checkbox-export-done"
        />
        <label
          htmlFor="checkoff-export"
          className={cn('cursor-pointer', checkoffs.exportDone && 'text-muted-foreground line-through decoration-muted-foreground/40')}
        >
          Payroll Export (Pezwise) done
        </label>
      </li>
      <li className="flex items-center gap-3 text-sm" data-testid="checklist-invoices">
        <Checkbox
          id="checkoff-invoices"
          checked={checkoffs.invoicesDone}
          onCheckedChange={(v) => checkoffs.setInvoicesDone(v === true)}
          data-testid="checkbox-invoices-done"
        />
        <label
          htmlFor="checkoff-invoices"
          className={cn('cursor-pointer', checkoffs.invoicesDone && 'text-muted-foreground line-through decoration-muted-foreground/40')}
        >
          Client Invoices done
        </label>
      </li>
    </ul>
  );
}
