import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useWorkflowSnapshot,
  useWorkflowCheckoffs,
  WeeklyChecklist,
} from '@/components/admin/workflow-progress';
import { CheckSquare, FileSpreadsheet, ChevronRight } from 'lucide-react';

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

/**
 * Dashboard guide: period status from real data, Molly's manual check-offs,
 * and which clients have approved entries waiting.
 */
export function NextStepsCard() {
  const snapshot = useWorkflowSnapshot(last30Days());
  const checkoffs = useWorkflowCheckoffs();
  const { isLoading, pendingCount, approvedCount, readyClients } = snapshot;

  const allDone =
    pendingCount === 0 && checkoffs.exportDone && checkoffs.invoicesDone;

  let message: string;
  if (pendingCount > 0) {
    message = `${pendingCount} time ${pendingCount === 1 ? 'entry' : 'entries'} waiting for approval.`;
  } else if (approvedCount > 0 && !allDone) {
    message = `${approvedCount} approved ${approvedCount === 1 ? 'entry' : 'entries'} ready across ${readyClients.length} ${readyClients.length === 1 ? 'client' : 'clients'}.`;
  } else if (allDone && approvedCount > 0) {
    message = 'All wrapped up for this week.';
  } else {
    message = 'No recent time entries. Guidance appears here as hours come in.';
  }

  const loading = isLoading || checkoffs.isLoading;

  return (
    <Card data-testid="card-next-steps">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Next Steps</CardTitle>
          {loading ? null : (
            <span className="text-sm text-muted-foreground" data-testid="text-next-steps-summary">
              {message}
            </span>
          )}
        </div>
        <CardDescription className="sr-only">Weekly workflow status</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-24 w-full max-w-xl" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <WeeklyChecklist snapshot={snapshot} checkoffs={checkoffs} />

            {readyClients.length > 0 && (
              <div className="rounded-md border bg-primary/5 px-4 py-3">
                <p className="text-sm font-medium mb-2">
                  Clients with approved entries ready
                </p>
                <div className="flex flex-wrap gap-2" data-testid="list-ready-clients">
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
              </div>
            )}
          </div>
        )}

        {!loading && (pendingCount > 0 || approvedCount > 0) && !allDone && (
          <div>
            <Link href={pendingCount > 0 ? '/admin/approve-payroll' : '/admin/reports'}>
              <Button size="sm" className="gap-2" data-testid="button-next-step">
                {pendingCount > 0 ? (
                  <CheckSquare className="h-4 w-4" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                {pendingCount > 0 ? 'Approve Payroll' : 'Open Reports'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
