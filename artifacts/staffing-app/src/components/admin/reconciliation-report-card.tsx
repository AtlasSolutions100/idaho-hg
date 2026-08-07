import { useState } from 'react';
import {
  useGetReconciliationReport,
  getGetReconciliationReportQueryKey,
  useListClients,
  type ReconciliationReport,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkflowSnapshot } from '@/components/admin/workflow-progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { visitTypeLabels } from '@/lib/data';
import { downloadCsv } from '@/lib/report-csv';
import { format } from 'date-fns';
import { FileSpreadsheet, Download, Loader2, AlertCircle, Inbox } from 'lucide-react';

function lineFlags(line: { isWeekend: boolean; isHoliday: boolean }): string {
  const flags: string[] = [];
  if (line.isWeekend) flags.push('Weekend');
  if (line.isHoliday) flags.push('Holiday');
  return flags.join(' + ');
}

/** Zero and null become blank cells — the CSV stays quiet where there's nothing to say. */
function num(value: number | null | undefined): string {
  return value != null && value !== 0 ? String(value) : '';
}

function visitSummary(counts: { visitType: string; count: number }[]): string {
  return counts
    .map((v) => `${visitTypeLabels[v.visitType as keyof typeof visitTypeLabels] ?? v.visitType}: ${v.count}`)
    .join('; ');
}

function reconciliationCsv(report: ReconciliationReport): string[][] {
  const rows: string[][] = [
    [`${report.clientName} — Reconciliation ${report.start} to ${report.end}`, '', '', '', '', '', '', '', ''],
    [],
    ['Date', 'Employee', 'Role', 'Visit Type', 'Hours', 'Mileage', 'Per Diem', 'Flags', 'Notes'],
  ];
  for (const emp of report.employees) {
    for (const line of emp.lines) {
      rows.push([
        line.date,
        emp.employeeName,
        emp.employeeRole,
        line.isOther ? 'Other' : line.visitType ? visitTypeLabels[line.visitType] : line.hours != null ? 'Hourly' : '',
        num(line.hours),
        num(line.mileage),
        num(line.perDiem),
        lineFlags(line),
        line.note,
      ]);
    }
    rows.push([
      '',
      `${emp.employeeName} — subtotal`,
      '',
      visitSummary(emp.visitCounts),
      num(emp.totalHours),
      num(emp.totalMileage),
      num(emp.totalPerDiem),
      '',
      '',
    ]);
    // Blank separator row between employee sections.
    rows.push([]);
  }
  rows.push([
    '',
    'Grand total',
    '',
    visitSummary(report.totals.visitCounts),
    num(report.totals.totalHours),
    num(report.totals.totalMileage),
    num(report.totals.totalPerDiem),
    '',
    '',
  ]);
  return rows;
}

export function ReconciliationReportCard() {
  const [clientId, setClientId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [params, setParams] = useState<{ clientId: string; start: string; end: string } | null>(null);

  const { data: clients } = useListClients();
  // Highlight clients with approved entries ready — scoped to the chosen
  // period once both dates are set, otherwise across all approved entries.
  const rangeSelected = start !== '' && end !== '' && start <= end;
  const { readyClients } = useWorkflowSnapshot(rangeSelected ? { start, end } : undefined);
  const readyByClient = new Map(readyClients.map((c) => [c.clientId, c.count]));
  const { data: report, isLoading, isError } = useGetReconciliationReport(
    params ?? { clientId: '', start: '', end: '' },
    {
      query: {
        enabled: params !== null,
        queryKey: getGetReconciliationReportQueryKey(params ?? { clientId: '', start: '', end: '' }),
      },
    },
  );

  const canGenerate = clientId !== '' && start !== '' && end !== '' && start <= end;
  const showResults = params !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <CardTitle>Client Reconciliation</CardTitle>
            <CardDescription>Detailed reconciliation with descriptive notes per visit</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="select-reconciliation-client">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((client) => {
                  const ready = readyByClient.get(client.id);
                  return (
                    <SelectItem key={client.id} value={client.id}>
                      <span className="flex items-center gap-2">
                        {client.name}
                        {ready != null && (
                          <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                            {ready} ready
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reconciliation-start">Period Start</Label>
            <Input
              id="reconciliation-start" type="date" value={start}
              onChange={(e) => setStart(e.target.value)}
              data-testid="input-period-start"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reconciliation-end">Period End</Label>
            <Input
              id="reconciliation-end" type="date" value={end}
              onChange={(e) => setEnd(e.target.value)}
              data-testid="input-period-end"
            />
          </div>
        </div>
        {start !== '' && end !== '' && start > end && (
          <p className="text-sm text-destructive">Start date must be on or before the end date.</p>
        )}
        <div className="flex gap-3 pt-2">
          <Button
            className="gap-2"
            disabled={!canGenerate || isLoading}
            onClick={() => setParams({ clientId, start, end })}
            data-testid="button-generate-client-reconciliation"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Generate Report
          </Button>
          <Button
            variant="outline" className="gap-2"
            disabled={!report || report.entryCount === 0}
            onClick={() => report && downloadCsv(`reconciliation-${report.clientName.replace(/\s+/g, '-').toLowerCase()}-${report.start}-to-${report.end}.csv`, reconciliationCsv(report))}
            data-testid="button-download-client-reconciliation"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        </div>

        {showResults && isLoading && (
          <div className="space-y-3 pt-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {showResults && isError && (
          <div className="py-8 text-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p>Couldn't generate the reconciliation report. Please try again.</p>
          </div>
        )}
        {report && report.entryCount === 0 && (
          <div className="py-8 text-center text-muted-foreground" data-testid="reconciliation-empty-state">
            <Inbox className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p>
              No approved time entries for {report.clientName} between{' '}
              {format(new Date(report.start), 'MMM d, yyyy')} and {format(new Date(report.end), 'MMM d, yyyy')}.
            </p>
            <p className="text-sm mt-1">Approve entries on the Approve Payroll page first.</p>
          </div>
        )}
        {report && report.entryCount > 0 && (() => {
          // Which measures actually appear anywhere in this report? Columns
          // with no data are dropped so a visit-heavy client (St. Luke's) and
          // an hours-based client (Weiser) each get an uncluttered layout.
          const hasHours = report.employees.some((e) => e.totalHours > 0);
          const hasMileage = report.employees.some((e) => e.totalMileage > 0);
          const hasPerDiem = report.employees.some((e) => e.totalPerDiem > 0);
          return (
          <div className="space-y-6 pt-2" data-testid="reconciliation-results">
            {report.employees.map((emp) => (
              <div key={emp.employeeId} className="border rounded-md overflow-hidden" data-testid={`reconciliation-employee-${emp.employeeId}`}>
                <div className="bg-muted/50 px-4 py-3 border-b">
                  <span className="font-semibold">{emp.employeeName}</span>{' '}
                  <span className="text-sm text-muted-foreground">{emp.employeeRole}</span>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        {hasHours && <TableHead className="text-right">Hours</TableHead>}
                        {hasMileage && <TableHead className="text-right">Mileage</TableHead>}
                        {hasPerDiem && <TableHead className="text-right">Per Diem</TableHead>}
                        <TableHead className="min-w-[16rem]">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emp.lines.map((line) => (
                        <TableRow key={line.entryId} data-testid={`reconciliation-line-${line.entryId}`}>
                          <TableCell className="font-mono text-sm whitespace-nowrap">
                            {format(new Date(`${line.date}T00:00:00`), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span>{line.isOther ? 'Other' : line.visitType ? visitTypeLabels[line.visitType] : line.hours != null ? 'Hourly' : ''}</span>
                              {line.isWeekend && <Badge variant="outline" className="text-xs">Weekend</Badge>}
                              {line.isHoliday && <Badge variant="outline" className="text-xs">Holiday</Badge>}
                            </div>
                          </TableCell>
                          {hasHours && <TableCell className="text-right font-mono">{line.hours || ''}</TableCell>}
                          {hasMileage && <TableCell className="text-right font-mono">{line.mileage || ''}</TableCell>}
                          {hasPerDiem && <TableCell className="text-right font-mono">{line.perDiem || ''}</TableCell>}
                          <TableCell className="text-sm max-w-md whitespace-normal">
                            {line.note !== '' && <span className="font-medium">{line.note}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div
                  className="bg-muted/30 px-4 py-2.5 flex flex-wrap items-center gap-2 border-t text-sm"
                  data-testid={`reconciliation-subtotal-${emp.employeeId}`}
                >
                  <span className="font-medium mr-auto">{emp.employeeName} — subtotal</span>
                  {emp.visitCounts.map((v) => (
                    <Badge key={v.visitType} variant="secondary" className="font-normal">
                      {visitTypeLabels[v.visitType]}: {v.count}
                    </Badge>
                  ))}
                  {emp.totalHours > 0 && <Badge variant="secondary" className="font-normal">{emp.totalHours} hrs</Badge>}
                  {emp.totalMileage > 0 && <Badge variant="secondary" className="font-normal">{emp.totalMileage} mi</Badge>}
                  {emp.totalPerDiem > 0 && <Badge variant="secondary" className="font-normal">Per diem: {emp.totalPerDiem}</Badge>}
                </div>
              </div>
            ))}
            <div className="border rounded-md bg-muted/30 px-4 py-3 flex flex-wrap items-center gap-2" data-testid="reconciliation-totals">
              <span className="font-semibold mr-auto">
                Totals for {report.clientName} ({report.entryCount} entr{report.entryCount === 1 ? 'y' : 'ies'})
              </span>
              {report.totals.visitCounts.map((v) => (
                <Badge key={v.visitType} variant="secondary" className="font-normal">
                  {visitTypeLabels[v.visitType]}: {v.count}
                </Badge>
              ))}
              {hasHours && <Badge variant="secondary" className="font-normal">{report.totals.totalHours} hrs</Badge>}
              {hasMileage && <Badge variant="secondary" className="font-normal">{report.totals.totalMileage} mi</Badge>}
              {hasPerDiem && <Badge variant="secondary" className="font-normal">Per diem: {report.totals.totalPerDiem}</Badge>}
            </div>
          </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
