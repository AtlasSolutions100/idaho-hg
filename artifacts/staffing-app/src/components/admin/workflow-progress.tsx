import { useListTimeEntries } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

// The natural weekly sequence, in order. Steps after approval can't be
// auto-detected as "done" (downloads are informational), so once approval is
// complete the export step is recommended and the rest follow.
export const WORKFLOW_STEPS = [
  'Approve Payroll',
  'Payroll Export (Pezwise)',
  'Client Invoices',
  'Reconciliation Reports',
] as const;

export type StepState = 'done' | 'next' | 'upcoming';

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
  stepStates: StepState[];
}

/**
 * Derives the current stage of the weekly workflow from time-entry data.
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

  const approvedCount = approvedEntries.length;
  const step1: StepState =
    pendingCount > 0 ? 'next' : approvedCount > 0 ? 'done' : 'upcoming';
  const step2: StepState = step1 === 'done' ? 'next' : 'upcoming';

  return {
    isLoading: entriesQuery.isLoading,
    pendingCount,
    approvedCount,
    readyClients,
    stepStates: [step1, step2, 'upcoming', 'upcoming'],
  };
}

/**
 * Lightweight four-step progress strip. The recommended next step is
 * emphasized; completed steps show a check; the rest stay muted. Purely
 * informational — nothing is gated.
 */
export function WorkflowProgress({
  stepStates,
  className,
}: {
  stepStates: StepState[];
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-wrap items-center gap-y-2', className)} data-testid="workflow-progress">
      {WORKFLOW_STEPS.map((label, i) => {
        const state = stepStates[i] ?? 'upcoming';
        return (
          <li key={label} className="flex items-center">
            {i > 0 && (
              <div className="mx-2 h-px w-4 sm:w-8 bg-border" aria-hidden="true" />
            )}
            <div
              aria-current={state === 'next' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-smooth',
                state === 'next' && 'border-primary bg-primary/10 text-primary font-medium',
                state === 'done' && 'border-transparent bg-muted text-muted-foreground',
                state === 'upcoming' && 'border-transparent text-muted-foreground',
              )}
              data-testid={`workflow-step-${i + 1}`}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'next' && 'bg-primary text-primary-foreground',
                  state === 'done' && 'bg-primary/15 text-primary',
                  state === 'upcoming' && 'bg-muted text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="whitespace-nowrap">{label}</span>
              <span className="sr-only">
                {state === 'done' ? ' (done)' : state === 'next' ? ' (next step)' : ' (upcoming)'}
              </span>
              {state === 'next' && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                  Next
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
