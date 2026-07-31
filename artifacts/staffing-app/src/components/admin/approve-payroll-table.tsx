import { useQueryClient } from '@tanstack/react-query';
import {
  useListTimeEntries,
  useApproveTimeEntry,
  useRejectTimeEntry,
  useApproveAllTimeEntries,
  getListTimeEntriesQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { visitTypeLabels } from '@/lib/data';
import { format } from 'date-fns';
import { Check, X, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ApprovePayrollTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: entries, isLoading, isError } = useListTimeEntries();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });

  const approveMutation = useApproveTimeEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({
          title: 'Entry approved',
          description: 'Time entry has been approved for payroll.',
        });
      },
      onError: () => {
        toast({
          title: 'Approval failed',
          description: 'Could not approve the entry. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const rejectMutation = useRejectTimeEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({
          title: 'Entry rejected',
          description: 'Time entry has been rejected.',
          variant: 'destructive',
        });
      },
      onError: () => {
        toast({
          title: 'Rejection failed',
          description: 'Could not reject the entry. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const approveAllMutation = useApproveAllTimeEntries({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast({
          title: `Approved ${result.approvedCount} entries`,
          description: 'All pending entries have been approved for payroll.',
        });
      },
      onError: () => {
        toast({
          title: 'Bulk approval failed',
          description: 'Could not approve all entries. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const pendingEntries = (entries ?? []).filter(e => e.status === 'submitted');
  const isActing =
    approveMutation.isPending || rejectMutation.isPending || approveAllMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Approve Payroll</CardTitle>
            <CardDescription>
              Review and approve submitted time entries
            </CardDescription>
          </div>
          {pendingEntries.length > 0 && (
            <Button
              onClick={() => approveAllMutation.mutate()}
              disabled={isActing}
              className="gap-2"
              data-testid="button-approve-all"
            >
              {approveAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Approve All ({pendingEntries.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <div className="py-12 text-center text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>Couldn't load time entries.</p>
            <p className="text-sm mt-1">Please try refreshing the page.</p>
          </div>
        ) : pendingEntries.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Check className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>All time entries have been reviewed.</p>
            <p className="text-sm mt-1">New submissions will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Mileage</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingEntries.map(entry => (
                  <TableRow key={entry.id} data-testid={`payroll-entry-${entry.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {entry.employeeName}
                        {entry.isDemo && (
                          <Badge variant="outline" className="text-xs font-normal">Demo</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{entry.employeeRole}</div>
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <div className="truncate">{entry.clientName}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm whitespace-nowrap">
                      {format(new Date(entry.date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      {entry.visitType ? (
                        <span className="text-sm">{visitTypeLabels[entry.visitType]}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Hourly</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.hours ? `${entry.hours}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.mileage ? `${entry.mileage} mi` : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {entry.isWeekend && (
                          <Badge variant="outline" className="text-xs">WE</Badge>
                        )}
                        {entry.isHoliday && (
                          <Badge variant="outline" className="text-xs">HOL</Badge>
                        )}
                        {entry.perDiem && entry.perDiem > 0 ? (
                          <Badge variant="outline" className="text-xs">PD</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {entry.note ? (
                        <p className="text-sm text-muted-foreground truncate">{entry.note}</p>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => rejectMutation.mutate({ id: entry.id })}
                          disabled={isActing}
                          className="h-8 gap-1 text-destructive hover:text-destructive"
                          data-testid={`button-reject-${entry.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approveMutation.mutate({ id: entry.id })}
                          disabled={isActing}
                          className="h-8 gap-1"
                          data-testid={`button-approve-${entry.id}`}
                        >
                          <Check className="h-4 w-4" />
                          Approve
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
