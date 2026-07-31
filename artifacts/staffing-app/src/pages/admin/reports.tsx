import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { PayrollReportCard } from '@/components/admin/payroll-report-card';
import { InvoiceReportCard } from '@/components/admin/invoice-report-card';
import { ReconciliationReportCard } from '@/components/admin/reconciliation-report-card';
import { MissingRatesNotice } from '@/components/admin/missing-rates-notice';
import {
  useWorkflowSnapshot,
  useWorkflowCheckoffs,
  WeeklyChecklist,
} from '@/components/admin/workflow-progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';

export default function ReportsPage() {
  const workflow = useWorkflowSnapshot();
  const checkoffs = useWorkflowCheckoffs();
  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold">Reports</h1>
              <p className="text-sm text-muted-foreground">Generate payroll and client reports</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {!workflow.isLoading && !checkoffs.isLoading && (
          <Card data-testid="card-report-readiness">
            <CardContent className="py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium mb-2">
                    {workflow.readyClients.length > 0
                      ? `${workflow.readyClients.length} ${workflow.readyClients.length === 1 ? 'client' : 'clients'} ready with approved entries`
                      : 'No clients have approved entries yet'}
                  </p>
                  {workflow.readyClients.length > 0 ? (
                    <div className="flex flex-wrap gap-2" data-testid="list-report-ready-clients">
                      {workflow.readyClients.map((c) => (
                        <Badge
                          key={c.clientId}
                          variant="outline"
                          className="gap-1.5 border-primary/40 bg-card py-1 pl-2.5 pr-2 text-sm font-normal"
                          data-testid={`report-ready-client-${c.clientId}`}
                        >
                          {c.clientName}
                          <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                            {c.count}
                          </span>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Approve time entries first — reports only include approved entries.
                    </p>
                  )}
                  {workflow.pendingCount > 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {workflow.pendingCount} time {workflow.pendingCount === 1 ? 'entry is' : 'entries are'} still
                      waiting for approval — reports only include approved entries.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">This week</p>
                  <WeeklyChecklist snapshot={workflow} checkoffs={checkoffs} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <MissingRatesNotice />
        <PayrollReportCard />
        <InvoiceReportCard />
        <ReconciliationReportCard />
      </div>
    </div>
  );
}
