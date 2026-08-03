import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useGetInvoiceReport,
  getGetInvoiceReportQueryKey,
  useListClients,
  useGetBusinessSettings,
  useGetQboStatus,
  useSendInvoiceToQbo,
  allocateInvoiceNumber,
  type InvoiceReport,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { downloadCsv, formatMoney } from '@/lib/report-csv';
import { downloadInvoicePdf } from '@/lib/invoice-pdf';
import { useToast } from '@/hooks/use-toast';
import { useWorkflowSnapshot } from '@/components/admin/workflow-progress';
import { ApiError } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { FileSpreadsheet, FileText, Download, Loader2, AlertCircle, AlertTriangle, Inbox, Send } from 'lucide-react';
import { Link } from 'wouter';

// Rates like mileage need 3 decimals (e.g. 0.655) so Qty × Rate matches Amount.
function formatRate(rate: number): string {
  return rate.toFixed(Number.isInteger(rate * 100) ? 2 : 3);
}

// QuickBooks-style columns, matching Molly's real invoices.
function invoiceCsv(report: InvoiceReport): string[][] {
  const rows: string[][] = [
    ['Date', 'Product or service', 'Description', 'Qty', 'Rate', 'Amount'],
  ];
  for (const line of report.lines) {
    rows.push([
      line.date,
      line.productService,
      // Missing rates must stay visible in the file too — never a silent $0.
      line.missingRate ? `${line.description} — NO RATE ON FILE` : line.description,
      String(line.qty),
      line.rate != null ? formatRate(line.rate) : '',
      line.amount.toFixed(2),
    ]);
  }
  rows.push(['', '', 'Grand total', '', '', report.total.toFixed(2)]);
  return rows;
}

export function InvoiceReportCard() {
  const [clientId, setClientId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [params, setParams] = useState<{ clientId: string; start: string; end: string } | null>(null);

  const { data: clients } = useListClients();
  const { data: businessSettings } = useGetBusinessSettings();
  const { toast } = useToast();
  const [pdfBusy, setPdfBusy] = useState(false);

  // Each PDF download claims the next invoice number from the server so
  // numbers never repeat. If numbering fails, the PDF still downloads
  // (without a number) and Molly is told explicitly.
  const handleDownloadPdf = async (invoiceReport: InvoiceReport) => {
    // Bill-to details (contact + address) come from the client record, keyed
    // by the client chosen for this report.
    const client = (clients ?? []).find((c) => c.id === params?.clientId);
    const billTo = {
      billingContact: client?.billingContact,
      billingAddress: client?.billingAddress,
    };
    setPdfBusy(true);
    try {
      const { invoiceNumber } = await allocateInvoiceNumber();
      downloadInvoicePdf(invoiceReport, businessSettings, invoiceNumber, billTo);
    } catch {
      downloadInvoicePdf(invoiceReport, businessSettings, undefined, billTo);
      toast({
        title: 'PDF downloaded without an invoice number',
        description: "Couldn't reach the server to get the next invoice number. Check your connection and try again if you need a numbered invoice.",
        variant: 'destructive',
      });
    } finally {
      setPdfBusy(false);
    }
  };
  // Send to QuickBooks: the server rebuilds the invoice from the database and
  // creates it in QBO in one call, so a failure never half-creates anything.
  const { data: qboStatus } = useGetQboStatus();
  const qboReady = qboStatus?.connected === true;
  // When the server reports this client + period was already sent, we hold
  // the request here and ask Molly to confirm before sending again.
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    clientId: string;
    start: string;
    end: string;
    message: string;
  } | null>(null);
  const sendToQbo = useSendInvoiceToQbo({
    mutation: {
      onSuccess: (sent) => {
        setDuplicatePrompt(null);
        toast({
          title: 'Invoice sent to QuickBooks',
          description: `${sent.lineCount} line${sent.lineCount === 1 ? '' : 's'} for ${sent.customerName}${sent.docNumber ? ` — QuickBooks invoice #${sent.docNumber}` : ''} (${formatMoney(sent.total)}). Review and send it from QuickBooks.`,
        });
      },
      onError: (error, variables) => {
        const errorData =
          error instanceof ApiError && error.data && typeof error.data === 'object'
            ? (error.data as { message?: string; alreadySent?: boolean })
            : undefined;
        // A calm confirmation, not an error: this invoice already went to
        // QuickBooks, so ask before creating it a second time.
        if (errorData?.alreadySent && errorData.message) {
          setDuplicatePrompt({
            clientId: variables.data.clientId,
            start: variables.data.start,
            end: variables.data.end,
            message: errorData.message,
          });
          return;
        }
        const serverMessage = errorData?.message;
        toast({
          title: "Couldn't send to QuickBooks",
          description:
            serverMessage ??
            'Something went wrong and nothing was created in QuickBooks. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  // Highlight clients with approved entries ready — scoped to the chosen
  // period once both dates are set, otherwise across all approved entries.
  const rangeSelected = start !== '' && end !== '' && start <= end;
  const { readyClients } = useWorkflowSnapshot(rangeSelected ? { start, end } : undefined);
  const readyByClient = new Map(readyClients.map((c) => [c.clientId, c.count]));
  const { data: report, isLoading, isError } = useGetInvoiceReport(
    params ?? { clientId: '', start: '', end: '' },
    {
      query: {
        enabled: params !== null,
        queryKey: getGetInvoiceReportQueryKey(params ?? { clientId: '', start: '', end: '' }),
      },
    },
  );

  const canGenerate = clientId !== '' && start !== '' && end !== '' && start <= end;
  const showResults = params !== null;

  // Gentle reminder: PDFs print name-only "Bill to" until billing details
  // are on file for the selected client.
  const selectedClient = (clients ?? []).find((c) => c.id === clientId);
  const missingBillingDetails =
    selectedClient != null && !selectedClient.billingAddress && !selectedClient.billingContact;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <CardTitle>Client Invoice Summary</CardTitle>
            <CardDescription>Invoice-style summary for client billing</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="select-invoice-client">
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
            <Label htmlFor="invoice-start">Invoice Period Start</Label>
            <Input
              id="invoice-start" type="date" value={start}
              onChange={(e) => setStart(e.target.value)}
              data-testid="input-invoice-period-start"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-end">Invoice Period End</Label>
            <Input
              id="invoice-end" type="date" value={end}
              onChange={(e) => setEnd(e.target.value)}
              data-testid="input-invoice-period-end"
            />
          </div>
        </div>
        {missingBillingDetails && (
          <div
            className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            data-testid="invoice-missing-billing-hint"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              {selectedClient.name} has no billing contact or address on file, so PDF invoices will
              show only the client name in the Bill to section.{' '}
              <Link href="/admin/client-rates" className="underline font-medium">
                Add billing details on the Client Rates page
              </Link>
            </p>
          </div>
        )}
        {start !== '' && end !== '' && start > end && (
          <p className="text-sm text-destructive">Start date must be on or before the end date.</p>
        )}
        <div className="flex gap-3 pt-2">
          <Button
            className="gap-2"
            disabled={!canGenerate || isLoading}
            onClick={() => setParams({ clientId, start, end })}
            data-testid="button-generate-client-invoice-summary"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Generate Report
          </Button>
          <Button
            variant="outline" className="gap-2"
            disabled={!report || report.entryCount === 0}
            onClick={() => report && downloadCsv(`invoice-${report.clientName.replace(/\s+/g, '-').toLowerCase()}-${report.start}-to-${report.end}.csv`, invoiceCsv(report))}
            data-testid="button-download-client-invoice-summary"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
          <Button
            variant="outline" className="gap-2"
            disabled={!report || report.entryCount === 0 || pdfBusy}
            onClick={() => report && handleDownloadPdf(report)}
            data-testid="button-download-client-invoice-pdf"
          >
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Download PDF
          </Button>
          <Button
            variant="outline" className="gap-2"
            disabled={!report || report.entryCount === 0 || sendToQbo.isPending}
            onClick={() => {
              if (!report) return;
              if (!qboReady) {
                toast({
                  title: 'QuickBooks is not connected',
                  description: 'Connect QuickBooks from the QuickBooks card on this dashboard, then try again.',
                });
                return;
              }
              sendToQbo.mutate({ data: { clientId: report.clientId, start: report.start, end: report.end } });
            }}
            data-testid="button-send-invoice-to-quickbooks"
          >
            {sendToQbo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send to QuickBooks
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
            <p>Couldn't generate the invoice report. Please try again.</p>
          </div>
        )}
        {report && report.entryCount === 0 && (
          <div className="py-8 text-center text-muted-foreground" data-testid="invoice-empty-state">
            <Inbox className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p>
              No approved time entries for {report.clientName} between{' '}
              {format(new Date(report.start), 'MMM d, yyyy')} and {format(new Date(report.end), 'MMM d, yyyy')}.
            </p>
            <p className="text-sm mt-1">Approve entries on the Approve Payroll page first.</p>
          </div>
        )}
        {report && report.entryCount > 0 && (
          <div className="space-y-4 pt-2" data-testid="invoice-results">
            {report.missingRateCount > 0 && (
              <div
                className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3"
                data-testid="invoice-missing-rate-banner"
              >
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300">
                    {report.missingRateCount === 1
                      ? '1 line has no billing rate and is billed as $0'
                      : `${report.missingRateCount} lines have no billing rate and are billed as $0`}
                  </p>
                  <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                    The highlighted rows below show a "No rate" badge. Fix the missing{' '}
                    {report.missingRateCount === 1 ? 'rate' : 'rates'} before sending this invoice.{' '}
                    <Link href="/admin/client-rates" className="underline font-medium">
                      Add rates on the Client Rates page
                    </Link>
                  </p>
                </div>
              </div>
            )}
            {report.unbilledCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {report.unbilledCount} entr{report.unbilledCount === 1 ? 'y has' : 'ies have'} nothing billable (no visit, hours, mileage, or per diem) and {report.unbilledCount === 1 ? 'is' : 'are'} not shown.
              </div>
            )}
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product or service</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line) => (
                    <TableRow
                      key={line.lineId}
                      data-testid={`invoice-line-${line.lineId}`}
                      className={line.missingRate ? 'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:hover:bg-amber-950/60' : undefined}
                    >
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {format(new Date(`${line.date}T00:00:00`), 'M/d/yy')}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{line.productService}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-sm">{line.description}</span>
                          {line.missingRate && <Badge variant="destructive" className="text-xs">No rate</Badge>}
                        </div>
                        {line.note && (
                          <div className={`text-xs mt-1 ${line.missingRate ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
                            {line.note}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{line.qty}</TableCell>
                      <TableCell className="text-right font-mono">{line.rate != null ? `$${formatRate(line.rate)}` : '—'}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatMoney(line.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end border-t pt-3">
              <div className="text-right">
                <div className="text-sm text-muted-foreground">
                  Invoice total for {report.clientName} ({report.entryCount} entries)
                </div>
                <div className="text-xl font-semibold" data-testid="invoice-total">{formatMoney(report.total)}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <AlertDialog
        open={duplicatePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicatePrompt(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-quickbooks-already-sent">
          <AlertDialogHeader>
            <AlertDialogTitle>Already sent to QuickBooks</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicatePrompt?.message} Would you like to send it again anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-duplicate-send">
              Don't send
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-duplicate-send"
              onClick={() => {
                if (!duplicatePrompt) return;
                sendToQbo.mutate({
                  data: {
                    clientId: duplicatePrompt.clientId,
                    start: duplicatePrompt.start,
                    end: duplicatePrompt.end,
                    confirmDuplicate: true,
                  },
                });
                setDuplicatePrompt(null);
              }}
            >
              Send again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
