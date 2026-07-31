import {
  useListTimeEntries,
  useGetWorkflowStatus,
  useUpdateWorkflowStatus,
  getGetWorkflowStatusQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, Clock } from 'lucide-react';

export interface ReadyClient {
  clientId: string;
  clientName: string;
  count: number;
}

export interface WorkflowSnapshot {
  isLoading: boolean;
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
    exportDone,
    invoicesDone,
    // Partial updates: only the toggled flag is sent, so rapid toggles of
    // both boxes can't overwrite each other with stale values.
    setExportDone: (v: boolean) => mutation.mutate({ data: { period, exportDone: v } }),
    setInvoicesDone: (v: boolean) => mutation.mutate({ data: { period, invoicesDone: v } }),
  };
}

/**
 * Calm, non-linear weekly checklist. Approval state comes from real data;
 * export and invoices are manual check-offs; reconciliation is informational.
 * Nothing is gated.
 */
export function WeeklyChecklist({
  snapshot,
  checkoffs,
  className,
}: {
  snapshot: WorkflowSnapshot;
  checkoffs: ReturnType<typeof useWorkflowCheckoffs>;
  className?: string;
}) {
  const { pendingCount, approvedCount } = snapshot;
  const approvalDone = pendingCount === 0 && approvedCount > 0;

  return (
    <ul className={cn('space-y-2', className)} data-testid="workflow-progress">
      {/* Approval: derived from data, not checkable */}
      <li className="flex items-center gap-3 text-sm" data-testid="checklist-approve">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            approvalDone ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {approvalDone ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        </span>
        <span className={cn(approvalDone && 'text-muted-foreground')}>
          Approve payroll
          {pendingCount > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {pendingCount} waiting
            </span>
          )}
          {approvalDone && <span className="sr-only"> (done)</span>}
        </span>
      </li>

      {/* Manual check-offs */}
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
          Payroll Export (Pezwise)
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
          Client Invoices
        </label>
      </li>

      {/* Informational — generated per client as needed */}
      <li className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="checklist-reconciliation">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        </span>
        Reconciliation reports — per client, as needed
      </li>
    </ul>
  );
}
