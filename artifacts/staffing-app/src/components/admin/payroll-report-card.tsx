import { useState } from 'react';
import {
  useGetPayrollReport,
  getGetPayrollReportQueryKey,
  type PayrollReport,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { visitTypeLabels } from '@/lib/data';
import { downloadCsv, formatMoney } from '@/lib/report-csv';
import { format } from 'date-fns';
import { FileSpreadsheet, Download, Loader2, AlertCircle, Inbox } from 'lucide-react';

function payrollCsv(report: PayrollReport): string[][] {
  const rows: string[][] = [
    ['Employee', 'Role', 'Date', 'Client', 'Type', 'Hours', 'Multiplier', 'Base Pay', 'Mileage', 'Mileage Pay', 'Per Diem Pay', 'Total', 'Missing Rate'],
  ];
  for (const emp of report.employees) {
    for (const line of emp.lines) {
      rows.push([
        emp.employeeName,
        emp.employeeRole,
        line.date,
        line.clientName,
        line.isOther
          ? `Other${line.description ? ` — ${line.description}` : ''}`
          : line.visitType
            ? visitTypeLabels[line.visitType]
            : 'Hourly',
        line.hours != null ? String(line.hours) : '',
        String(line.multiplier),
        line.basePay.toFixed(2),
        line.mileage != null ? String(line.mileage) : '',
        line.mileagePay.toFixed(2),
        line.perDiemPay.toFixed(2),
        line.total.toFixed(2),
        line.missingRate ? 'YES' : '',
      ]);
    }
    rows.push([
      `${emp.employeeName} — subtotal`, '', '', '',
      `${emp.visitCount} visits`, String(emp.totalHours), '',
      emp.basePay.toFixed(2), '', emp.mileagePay.toFixed(2),
      emp.perDiemPay.toFixed(2), emp.total.toFixed(2), '',
    ]);
  }
  rows.push(['Grand total', '', '', '', '', '', '', '', '', '', '', report.grandTotal.toFixed(2), '']);
  return rows;
}

export function PayrollReportCard() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [params, setParams] = useState<{ start: string; end: string } | null>(null);

  const { data: report, isLoading, isError } = useGetPayrollReport(
    params ?? { start: '', end: '' },
    {
      query: {
        enabled: params !== null,
        queryKey: getGetPayrollReportQueryKey(params ?? { start: '', end: '' }),
      },
    },
  );

  const canGenerate = start !== '' && end !== '' && start <= end;
  const showResults = params !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <CardTitle>Payroll Export (Pezwise)</CardTitle>
            <CardDescription>Generate payroll list for Pezwise import</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="payroll-start">Pay Period Start</Label>
            <Input
              id="payroll-start" type="date" value={start}
              onChange={(e) => setStart(e.target.value)}
              data-testid="input-pay-period-start"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payroll-end">Pay Period End</Label>
            <Input
              id="payroll-end" type="date" value={end}
              onChange={(e) => setEnd(e.target.value)}
              data-testid="input-pay-period-end"
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
            onClick={() => setParams({ start, end })}
            data-testid="button-generate-payroll-export-(pezwise)"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Generate Report
          </Button>
          <Button
            variant="outline" className="gap-2"
            disabled={!report || report.entryCount === 0}
            onClick={() => report && downloadCsv(`payroll-${report.start}-to-${report.end}.csv`, payrollCsv(report))}
            data-testid="button-download-payroll-export-(pezwise)"
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
            <p>Couldn't generate the payroll report. Please try again.</p>
          </div>
        )}
        {report && report.entryCount === 0 && (
          <div className="py-8 text-center text-muted-foreground" data-testid="payroll-empty-state">
            <Inbox className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p>No approved time entries between {format(new Date(report.start), 'MMM d, yyyy')} and {format(new Date(report.end), 'MMM d, yyyy')}.</p>
            <p className="text-sm mt-1">Approve entries on the Approve Payroll page first.</p>
          </div>
        )}
        {report && report.entryCount > 0 && (
          <div className="space-y-6 pt-2" data-testid="payroll-results">
            {report.missingRateCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                <AlertCircle className="h-4 w-4" />
                {report.missingRateCount} entr{report.missingRateCount === 1 ? 'y has' : 'ies have'} no pay rate on file — shown with a "No rate" badge and counted as $0.
              </div>
            )}
            {report.employees.map((emp) => (
              <div key={emp.employeeId} className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-medium">
                    {emp.employeeName}
                    <span className="text-muted-foreground font-normal text-sm ml-2">{emp.employeeRole}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {emp.visitCount} visit{emp.visitCount === 1 ? '' : 's'} · {emp.totalHours} hr · <span className="font-semibold text-foreground">{formatMoney(emp.total)}</span>
                  </div>
                </div>
                <div className="overflow-x-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Mult.</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">Mileage</TableHead>
                        <TableHead className="text-right">Per Diem</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emp.lines.map((line) => (
                        <TableRow key={line.entryId} data-testid={`payroll-line-${line.entryId}`}>
                          <TableCell className="font-mono text-sm whitespace-nowrap">
                            {format(new Date(line.date), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="max-w-[160px]"><div className="truncate">{line.clientName}</div></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-sm">
                                {line.isOther ? 'Other' : line.visitType ? visitTypeLabels[line.visitType] : 'Hourly'}
                              </span>
                              {line.isOther && line.description ? (
                                <span className="text-xs text-muted-foreground truncate max-w-[180px]" title={line.description}>
                                  {line.description}
                                </span>
                              ) : null}
                              {line.isWeekend && <Badge variant="outline" className="text-xs">WE</Badge>}
                              {line.isHoliday && <Badge variant="outline" className="text-xs">HOL</Badge>}
                              {line.missingRate && (
                                <Badge variant="destructive" className="text-xs">
                                  {line.isOther ? 'Needs amount' : 'No rate'}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">{line.hours ?? '—'}</TableCell>
                          <TableCell className="text-right font-mono">{line.multiplier > 1 ? `×${line.multiplier}` : '—'}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(line.basePay)}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(line.mileagePay)}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(line.perDiemPay)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatMoney(line.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
            <div className="flex justify-end border-t pt-3">
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Grand total ({report.entryCount} entries)</div>
                <div className="text-xl font-semibold" data-testid="payroll-grand-total">{formatMoney(report.grandTotal)}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
