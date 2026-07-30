import { useState } from 'react';
import {
  useGetReconciliationReport,
  getGetReconciliationReportQueryKey,
  useListClients,
  type ReconciliationReport,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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

function reconciliationCsv(report: ReconciliationReport): string[][] {
  const rows: string[][] = [
    ['Client', 'Date', 'Employee', 'Role', 'Type', 'Hours', 'Note'],
  ];
  for (const line of report.lines) {
    rows.push([
      report.clientName,
      line.date,
      line.employeeName,
      line.employeeRole,
      line.visitType ? visitTypeLabels[line.visitType] : 'Hourly',
      line.hours != null ? String(line.hours) : '',
      line.note,
    ]);
  }
  return rows;
}

export function ReconciliationReportCard() {
  const [clientId, setClientId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [params, setParams] = useState<{ clientId: string; start: string; end: string } | null>(null);

  const { data: clients } = useListClients();
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
                {(clients ?? []).map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
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
        {report && report.entryCount > 0 && (
          <div className="space-y-4 pt-2" data-testid="reconciliation-results">
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line) => (
                    <TableRow key={line.entryId} data-testid={`reconciliation-line-${line.entryId}`}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {format(new Date(line.date), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{line.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{line.employeeRole}</div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {line.visitType ? visitTypeLabels[line.visitType] : 'Hourly'}
                      </TableCell>
                      <TableCell className="text-right font-mono">{line.hours ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-md">
                        {line.note !== '' ? line.note : <span className="text-muted-foreground">No note</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-sm text-muted-foreground text-right">
              {report.entryCount} visit{report.entryCount === 1 ? '' : 's'} for {report.clientName}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
