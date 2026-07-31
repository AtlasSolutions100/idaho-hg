import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useWorkflowSnapshot,
  useWorkflowCheckoffs,
} from '@/components/admin/workflow-progress';
import {
  CheckSquare,
  FileSpreadsheet,
  Receipt,
  ChevronRight,
  CircleCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Trailing 30 days: Molly usually processes the prior week(s), so a strict
// current-week scope would hide waiting work. Older, already-invoiced
// entries naturally age out of the summary.
function last30Days() {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return { start: fmt(start), end: fmt(end) };
}

interface AttentionItem {
  key: string;
  icon: LucideIcon;
  text: string;
  href: string;
  action: string;
  extra?: ReactNode;
}

/**
 * Smart to-do list for the dashboard: only shows what currently needs
 * attention, derived from live data. Disappears into a calm all-clear
 * state when nothing is waiting.
 */
export function NextStepsCard() {
  const snapshot = useWorkflowSnapshot(last30Days());
  const checkoffs = useWorkflowCheckoffs();
  const { isLoading, pendingCount, approvedCount, readyClients } = snapshot;
  const loading = isLoading || checkoffs.isLoading;
  const loadFailed = snapshot.isError || checkoffs.isError;

  const items: AttentionItem[] = [];

  if (pendingCount > 0) {
    items.push({
      key: 'approve',
      icon: CheckSquare,
      text: `${pendingCount} time ${pendingCount === 1 ? 'entry' : 'entries'} waiting for approval`,
      href: '/admin/approve-payroll',
      action: 'Approve',
    });
  }

  if (approvedCount > 0 && !checkoffs.exportDone) {
    items.push({
      key: 'export',
      icon: FileSpreadsheet,
      text: `Payroll export not done yet this week (${approvedCount} approved ${approvedCount === 1 ? 'entry' : 'entries'})`,
      href: '/admin/reports',
      action: 'Open Reports',
    });
  }

  if (readyClients.length > 0 && !checkoffs.invoicesDone) {
    items.push({
      key: 'invoices',
      icon: Receipt,
      text: `${readyClients.length} ${readyClients.length === 1 ? 'client has' : 'clients have'} approved entries ready to invoice`,
      href: '/admin/reports',
      action: 'Open Reports',
      extra: (
        <div className="flex flex-wrap gap-2 mt-2" data-testid="list-ready-clients">
          {readyClients.map((c) => (
            <Link key={c.clientId} href="/admin/reports">
              <Badge
                variant="outline"
                className="cursor-pointer gap-1.5 border-primary/40 bg-card py-1 pl-2.5 pr-2 text-sm font-normal hover:border-primary transition-smooth"
                data-testid={`ready-client-${c.clientId}`}
              >
                {c.clientName}
                <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                  {c.count}
                </span>
              </Badge>
            </Link>
          ))}
        </div>
      ),
    });
  }

  const hasRecentWork = pendingCount > 0 || approvedCount > 0;
  const summary = loadFailed
    ? "Couldn't check for pending work"
    : items.length === 0
      ? hasRecentWork
        ? "You're all caught up."
        : 'Nothing waiting. Items appear here as hours come in.'
      : `${items.length} ${items.length === 1 ? 'item needs' : 'items need'} attention`;

  return (
    <Card data-testid="card-next-steps">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Needs Attention</CardTitle>
          {loading ? null : (
            <span className="text-sm text-muted-foreground" data-testid="text-next-steps-summary">
              {summary}
            </span>
          )}
        </div>
        <CardDescription className="sr-only">Live list of pending work</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-16 w-full max-w-xl" />
        ) : loadFailed ? (
          <p className="text-sm text-muted-foreground" data-testid="text-attention-error">
            Something went wrong loading this list — refresh the page to try again.
          </p>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="text-all-clear">
            <CircleCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            {hasRecentWork
              ? 'Payroll is approved and this week’s export and invoices are marked done. If more work comes in, untick the boxes on the Reports page.'
              : 'New time entries will show up here for approval.'}
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item, i) => (
              <li
                key={item.key}
                className="rounded-md border bg-primary/5 px-4 py-3"
                data-testid={`attention-${item.key}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-3 text-sm">
                    <item.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {item.text}
                  </span>
                  <Link href={item.href}>
                    <Button
                      size="sm"
                      variant={i === 0 ? 'default' : 'outline'}
                      className="gap-1.5"
                      data-testid={i === 0 ? 'button-next-step' : `button-attention-${item.key}`}
                    >
                      {item.action}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
                {item.extra}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
