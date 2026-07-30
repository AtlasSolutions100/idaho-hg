import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mockTimeEntries, statusLabels, visitTypeLabels, type TimeEntry } from '@/lib/data';
import { format } from 'date-fns';
import { Check, X, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ApprovePayrollTable() {
  const [entries, setEntries] = useState(mockTimeEntries);
  const { toast } = useToast();

  const pendingEntries = entries.filter(e => e.status === 'submitted');

  const handleApprove = (entryId: string) => {
    setEntries(prev => 
      prev.map(e => 
        e.id === entryId 
          ? { ...e, status: 'approved' as const, approvedAt: new Date().toISOString() } 
          : e
      )
    );
    toast({
      title: 'Entry approved',
      description: 'Time entry has been approved for payroll.',
    });
  };

  const handleReject = (entryId: string) => {
    setEntries(prev => 
      prev.map(e => 
        e.id === entryId 
          ? { ...e, status: 'rejected' as const } 
          : e
      )
    );
    toast({
      title: 'Entry rejected',
      description: 'Time entry has been rejected.',
      variant: 'destructive',
    });
  };

  const handleApproveAll = () => {
    setEntries(prev => 
      prev.map(e => 
        e.status === 'submitted' 
          ? { ...e, status: 'approved' as const, approvedAt: new Date().toISOString() } 
          : e
      )
    );
    toast({
      title: `Approved ${pendingEntries.length} entries`,
      description: 'All pending entries have been approved for payroll.',
    });
  };

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
            <Button onClick={handleApproveAll} className="gap-2" data-testid="button-approve-all">
              <Check className="h-4 w-4" />
              Approve All ({pendingEntries.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {pendingEntries.length === 0 ? (
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
                      <div>{entry.employeeName}</div>
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
                        {entry.perDiem && entry.perDiem > 0 && (
                          <Badge variant="outline" className="text-xs">PD</Badge>
                        )}
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
                          onClick={() => handleReject(entry.id)}
                          className="h-8 gap-1 text-destructive hover:text-destructive"
                          data-testid={`button-reject-${entry.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(entry.id)}
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
