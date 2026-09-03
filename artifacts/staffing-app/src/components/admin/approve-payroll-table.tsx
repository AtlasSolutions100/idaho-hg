import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type TimeEntry,
  useListTimeEntries,
  useApproveTimeEntry,
  useRejectTimeEntry,
  useApproveAllTimeEntries,
  usePriceTimeEntry,
  getListTimeEntriesQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { visitTypeLabels, perDiemTypeLabels } from '@/lib/data';
import { useVisitTypes } from '@/lib/use-visit-types';
import { format } from 'date-fns';
import { Check, X, Loader2, AlertCircle, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AdminEditEntryForm } from './admin-edit-entry-form';

/** Monday (local) of the week containing a YYYY-MM-DD date, as YYYY-MM-DD. */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(y, m - 1, d - diff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

/** Human label for a week key, e.g. "Week of Aug 3, 2026". */
export function weekLabel(mondayKey: string): string {
  const [y, m, d] = mondayKey.split('-').map(Number);
  return `Week of ${format(new Date(y, m - 1, d), 'MMM d, yyyy')}`;
}

/**
 * Everything the employee logged for one employee/client/day, pulled together.
 * Multi-visit St. Luke's days are stored as one entry per visit type with the
 * day's mileage and per diem recorded on the first entry only — so the day
 * summary counts visit types across siblings and reports mileage/per diem
 * once for the whole day.
 */
export function daySummary(
  entry: TimeEntry,
  all: TimeEntry[],
  // Resolves a visit-type key to its catalog label. Defaults to the legacy
  // hardcoded map so this pure helper stays usable outside React (and in unit
  // tests); the component passes labelFor from the visit-types catalog so
  // newly-added types render with their real label instead of the raw key.
  labelFor: (key: string | null | undefined) => string = (key) =>
    key ? (visitTypeLabels[key] ?? key) : '',
) {
  // Only entries that still count toward the day: waiting or already
  // approved. Drafts are private and rejected siblings are out of play —
  // including them would show Molly stale visit counts, mileage, or notes.
  const siblings = all.filter(
    (e) =>
      e.employeeId === entry.employeeId &&
      e.clientId === entry.clientId &&
      e.date === entry.date &&
      (e.status === 'submitted' || e.status === 'approved'),
  );
  const visitCounts = new Map<string, number>();
  let mileage = 0;
  let perDiemType: string | undefined;
  // Legacy entries carry only a numeric per diem with no type — still payable
  // compensation, so the day total must surface it.
  let perDiemCount = 0;
  let isWeekend = false;
  let isHoliday = false;
  for (const e of siblings) {
    if (e.isWeekend) isWeekend = true;
    if (e.isHoliday) isHoliday = true;
    if (e.visitType) {
      const label = labelFor(e.visitType);
      // An entry can cover more than one of the same visit ("2 evals"), so the
      // day's tally counts visits performed rather than rows submitted.
      visitCounts.set(label, (visitCounts.get(label) ?? 0) + (e.quantity ?? 1));
    }
    if (e.mileage) mileage += e.mileage;
    if (e.perDiemType) perDiemType = e.perDiemType;
    if (e.perDiem) perDiemCount += e.perDiem;
  }
  const notes = [...new Set(siblings.map((e) => e.note).filter((n): n is string => !!n))];
  return {
    siblings,
    visitCounts: [...visitCounts.entries()],
    totalVisits: siblings.reduce((sum, e) => sum + (e.visitType ? (e.quantity ?? 1) : 0), 0),
    mileage,
    perDiemType,
    perDiemCount,
    isWeekend,
    isHoliday,
    notes,
  };
}

/**
 * Pay/bill amounts for an "Other" one-off. These entries have no rate table —
 * Molly types in what the employee gets paid, and (optionally) what the
 * client is billed. Left unset, the entry is flagged on the payroll report
 * instead of quietly paying $0.
 */
function OtherPricingForm({ entry, onError }: { entry: TimeEntry; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pay, setPay] = useState(entry.customPayAmount != null ? String(entry.customPayAmount) : '');
  const [bill, setBill] = useState(entry.customBillAmount != null ? String(entry.customBillAmount) : '');
  const priceMutation = usePriceTimeEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
        toast({ title: 'Amount saved', description: `${entry.employeeName}'s one-off is priced for payroll.` });
      },
      onError: (err: unknown) => {
        const message =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "Couldn't save the amount. Please try again.";
        onError(message);
      },
    },
  });
  const payNum = pay.trim() === '' ? null : Number(pay);
  const billNum = bill.trim() === '' ? null : Number(bill);
  const valid =
    (payNum == null || (Number.isFinite(payNum) && payNum >= 0)) &&
    (billNum == null || (Number.isFinite(billNum) && billNum >= 0));
  return (
    <div className="rounded-md border bg-background p-3 space-y-3" data-testid={`other-pricing-${entry.id}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        One-off pay &amp; billing
      </div>
      <div className="grid gap-3 sm:grid-cols-2 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor={`pay-${entry.id}`}>Pay {entry.employeeName.split(' ')[0]} ($)</Label>
          <Input
            id={`pay-${entry.id}`}
            type="number"
            min="0"
            step="0.01"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            placeholder="0.00"
            data-testid={`input-custom-pay-${entry.id}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`bill-${entry.id}`}>Bill {entry.clientName} ($, optional)</Label>
          <Input
            id={`bill-${entry.id}`}
            type="number"
            min="0"
            step="0.01"
            value={bill}
            onChange={(e) => setBill(e.target.value)}
            placeholder="Not billed"
            data-testid={`input-custom-bill-${entry.id}`}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!valid || priceMutation.isPending}
          onClick={() =>
            priceMutation.mutate({
              id: entry.id,
              data: { customPayAmount: payNum, ...(billNum != null ? { customBillAmount: billNum } : {}) },
            })
          }
          data-testid={`button-save-pricing-${entry.id}`}
        >
          {priceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save amounts
        </Button>
        {entry.customPayAmount == null && (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            Without a pay amount this shows as "needs amount" on payroll — it never quietly pays $0.
          </span>
        )}
      </div>
    </div>
  );
}

export function ApprovePayrollTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { labelFor } = useVisitTypes();
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
        const skipped = result.skippedUnpricedOtherCount ?? 0;
        toast({
          title: `Approved ${result.approvedCount} entries`,
          description:
            skipped > 0
              ? `${skipped} one-off ${skipped === 1 ? 'entry still needs' : 'entries still need'} a pay amount before approval — set it in the entry's details.`
              : 'Every entry that was waiting — across all weeks — is now approved for payroll.',
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const toggleExpanded = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pendingEntries = (entries ?? []).filter(e => e.status === 'submitted');
  const isActing =
    approveMutation.isPending || rejectMutation.isPending || approveAllMutation.isPending;

  // Group waiting entries by the Monday of their week, newest week first,
  // so it's always clear which week each entry belongs to.
  const weekGroups = new Map<string, typeof pendingEntries>();
  for (const entry of pendingEntries) {
    const key = mondayOf(entry.date);
    const group = weekGroups.get(key);
    if (group) group.push(entry);
    else weekGroups.set(key, [entry]);
  }
  const sortedWeeks = [...weekGroups.keys()].sort((a, b) => (a < b ? 1 : -1));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Approve Payroll</CardTitle>
            <CardDescription>
              Review and approve submitted time entries, grouped by week. "Approve
              all" approves every entry waiting for approval, across all weeks.
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
              Approve all {pendingEntries.length} waiting
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
            <p>Nothing is waiting for approval right now.</p>
            <p className="text-sm mt-1">When your team submits time, it will show up here grouped by week.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedWeeks.map(weekKey => (
              <div key={weekKey}>
                <h3
                  className="text-sm font-semibold text-muted-foreground mb-2"
                  data-testid={`week-heading-${weekKey}`}
                >
                  {weekLabel(weekKey)}
                </h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
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
                {weekGroups.get(weekKey)!.map(entry => {
                  const expanded = expandedIds.has(entry.id);
                  const day = expanded ? daySummary(entry, entries ?? [], labelFor) : null;
                  return [
                  <TableRow
                    key={entry.id}
                    data-testid={`payroll-entry-${entry.id}`}
                    className="cursor-pointer"
                    onClick={() => toggleExpanded(entry.id)}
                  >
                    <TableCell className="pr-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        aria-label={expanded ? 'Hide details' : 'Show details'}
                        aria-expanded={expanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(entry.id);
                        }}
                        data-testid={`button-expand-${entry.id}`}
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </TableCell>
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
                      {entry.endDate && entry.endDate !== entry.date
                        ? `${format(new Date(entry.date), 'MMM d')} – ${format(new Date(entry.endDate), 'MMM d, yyyy')}`
                        : format(new Date(entry.date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      {entry.isOther ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">Other</span>
                          {entry.customPayAmount == null ? (
                            <Badge variant="outline" className="text-xs border-amber-500 text-amber-600 dark:text-amber-500" data-testid={`badge-needs-amount-${entry.id}`}>
                              Needs amount
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-priced-${entry.id}`}>
                              ${entry.customPayAmount}
                            </Badge>
                          )}
                        </div>
                      ) : entry.visitType ? (
                        <span className="text-sm">
                          {labelFor(entry.visitType)}
                          {(entry.quantity ?? 1) > 1 && (
                            <span className="text-muted-foreground"> ×{entry.quantity}</span>
                          )}
                        </span>
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
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
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
                  </TableRow>,
                  expanded && day ? (
                    <TableRow key={`${entry.id}-detail`} className="hover:bg-transparent">
                      <TableCell
                        colSpan={10}
                        className="bg-muted/40 px-6 py-4"
                        data-testid={`entry-detail-${entry.id}`}
                      >
                        {editingId === entry.id ? (
                          <div className="max-w-3xl">
                            <AdminEditEntryForm
                              entry={entry}
                              onSaved={() => {
                                setEditingId(null);
                                invalidate();
                                toast({
                                  title: 'Entry updated',
                                  description: `${entry.employeeName} will see what you changed.`,
                                });
                              }}
                              onCancel={() => setEditingId(null)}
                              onError={(message) =>
                                toast({
                                  title: "Couldn't save changes",
                                  description: message,
                                  variant: 'destructive',
                                })
                              }
                            />
                          </div>
                        ) : (
                        <div className="max-w-3xl space-y-4">
                          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                            {day.totalVisits > 0 && (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                                  Visits this day ({day.totalVisits})
                                </div>
                                <ul className="space-y-0.5" data-testid={`detail-visits-${entry.id}`}>
                                  {day.visitCounts.map(([label, count]) => (
                                    <li key={label} className={label === (entry.visitType ? labelFor(entry.visitType) : '') ? 'font-medium' : ''}>
                                      {count} × {label}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Time</div>
                              <div data-testid={`detail-time-${entry.id}`}>
                                {entry.timeIn && entry.timeOut
                                  ? `${entry.timeIn} – ${entry.timeOut} (${entry.hours ?? '—'} hrs)`
                                  : entry.hours
                                    ? `${entry.hours} hours`
                                    : 'Per-visit (no clock times)'}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Mileage (day)</div>
                              <div data-testid={`detail-mileage-${entry.id}`}>
                                {day.mileage ? `${day.mileage} miles` : 'None'}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Per diem</div>
                              <div data-testid={`detail-perdiem-${entry.id}`}>
                                {day.perDiemType
                                  ? (perDiemTypeLabels[day.perDiemType] ?? day.perDiemType)
                                  : day.perDiemCount > 0
                                    ? `Yes (${day.perDiemCount})`
                                    : 'None'}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Day flags</div>
                              <div className="flex gap-1.5" data-testid={`detail-flags-${entry.id}`}>
                                {day.isWeekend && <Badge variant="outline" className="text-xs">Weekend</Badge>}
                                {day.isHoliday && <Badge variant="outline" className="text-xs">Holiday</Badge>}
                                {!day.isWeekend && !day.isHoliday && (
                                  <span className="text-muted-foreground">Regular weekday</span>
                                )}
                              </div>
                            </div>
                            {entry.submittedAt && !Number.isNaN(new Date(entry.submittedAt).getTime()) && (
                              <div>
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Submitted</div>
                                <div className="text-muted-foreground">
                                  {format(new Date(entry.submittedAt), 'MMM d, yyyy h:mm a')}
                                </div>
                              </div>
                            )}
                          </div>
                          {entry.adminEditedAt && !Number.isNaN(new Date(entry.adminEditedAt).getTime()) && (
                            <div className="sm:col-span-2 lg:col-span-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">You adjusted this entry</div>
                              <div className="text-muted-foreground" data-testid={`detail-admin-edit-${entry.id}`}>
                                {format(new Date(entry.adminEditedAt), 'MMM d, yyyy h:mm a')}
                                {entry.adminEditSummary ? ` — ${entry.adminEditSummary}` : ''}
                              </div>
                            </div>
                          )}
                          {entry.isOther && (
                            <OtherPricingForm
                              entry={entry}
                              onError={(message) =>
                                toast({ title: "Couldn't save the amount", description: message, variant: 'destructive' })
                              }
                            />
                          )}
                          {day.notes.length > 0 && (
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Notes</div>
                              <div
                                className="rounded-md border bg-background px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap"
                                data-testid={`detail-note-${entry.id}`}
                              >
                                {day.notes.join('\n')}
                              </div>
                            </div>
                          )}
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => setEditingId(entry.id)}
                              disabled={isActing}
                              data-testid={`button-fix-entry-${entry.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Fix this entry
                            </Button>
                          </div>
                        </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : null,
                  ];
                })}
              </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
