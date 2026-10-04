import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBatchCreateTimeEntries,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useListClients,
  getListTimeEntriesQueryKey,
  type PerDiemType,
  type TimeEntry,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useVisitTypes } from '@/lib/use-visit-types';
import { VisitPicker, type VisitLine } from '@/components/employee/visit-picker';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2 } from 'lucide-react';

interface LogHoursFormProps {
  employeeId?: string;
  /**
   * The signed-in employee's discipline. Narrows the visit-type list to what
   * their profession actually performs. Undefined (signed-out demo) shows all.
   */
  discipline?: string | null;
  /** When set, the form edits this existing entry instead of creating one. */
  entry?: TimeEntry;
  /** Drafts require a signed-in employee — the server refuses anonymous drafts. */
  allowDraft?: boolean;
  onSubmit: (savedAsDraft: boolean) => void;
  onCancel: () => void;
}

/** Hours between two "HH:MM" times; an earlier (or equal) time out means the shift crossed midnight. */
export function calculateHours(timeIn: string, timeOut: string): number | null {
  if (!timeIn || !timeOut) return null;
  const [inH, inM] = timeIn.split(':').map(Number);
  const [outH, outM] = timeOut.split(':').map(Number);
  if ([inH, inM, outH, outM].some((n) => n == null || Number.isNaN(n))) return null;
  let minutes = outH! * 60 + outM! - (inH! * 60 + inM!);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

export function LogHoursForm({ employeeId = '1', discipline, entry, allowDraft = false, onSubmit, onCancel }: LogHoursFormProps) {
  const isEditing = !!entry;
  const [entryType, setEntryType] = useState<'visit' | 'hourly' | 'other'>(
    entry ? (entry.isOther ? 'other' : entry.visitType ? 'visit' : 'hourly') : 'visit',
  );
  const [clientId, setClientId] = useState(entry?.clientId ?? '');
  // The visits chosen for this day, each with how many. Editing an existing
  // entry works on exactly one line (an entry holds one visit type).
  const [visitLines, setVisitLines] = useState<VisitLine[]>(
    entry?.visitType
      ? [{ visitType: entry.visitType, quantity: entry.quantity ?? 1 }]
      : [],
  );
  // Regular worked hours, time carried on call, or being called in while on
  // call — the last of which several contracts pay a minimum for.
  const [hourKind, setHourKind] = useState<'regular' | 'on-call' | 'call-back'>(
    entry?.hourKind ?? 'regular',
  );
  const [timeIn, setTimeIn] = useState(entry?.timeIn ?? '');
  const [timeOut, setTimeOut] = useState(entry?.timeOut ?? '');
  const [date, setDate] = useState(entry?.date ?? new Date().toISOString().split('T')[0]);
  const [hasMileage, setHasMileage] = useState(!!entry?.mileage);
  const [mileage, setMileage] = useState(entry?.mileage ? String(entry.mileage) : '');
  // St. Luke's employees pull a mileage report off the client's device for a
  // whole pay period, so mileage can cover a range instead of a single day.
  const [mileageIsRange, setMileageIsRange] = useState(!!entry?.endDate);
  const [mileageEndDate, setMileageEndDate] = useState(entry?.endDate ?? '');
  const [perDiemType, setPerDiemType] = useState<PerDiemType | ''>(entry?.perDiemType ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savingAction, setSavingAction] = useState<'draft' | 'submit'>('submit');

  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Active visit types come from the admin-managed catalog, so a type Molly
  // adds shows up here with no code change. labelFor resolves display names
  // (with a fallback for keys that predate the catalog).
  const {
    visitTypes,
    labelFor,
    typeFor,
    activeCountBeforeFilter,
    isLoading: visitTypesLoading,
    isError: visitTypesError,
  } = useVisitTypes(discipline);
  const { data: clients, isLoading: clientsLoading } = useListClients();
  const createEntry = useCreateTimeEntry();
  const updateEntry = useUpdateTimeEntry();
  const batchCreateEntries = useBatchCreateTimeEntries();

  const selectedClient = (clients ?? []).find((c) => c.id === clientId);
  // Hide (and never submit) mileage for clients whose contract doesn't include it.
  const mileageAllowed = selectedClient ? selectedClient.mileageOnContract : true;
  // Visit types only apply to clients that bill by visit type (St. Luke's);
  // everyone else gets the simple time-in/time-out form.
  const billsByVisit = selectedClient?.billsByVisitType ?? false;
  // "Other" is always available (one-offs like training or meetings happen
  // for any client); Visit only for clients that bill by visit type.
  const effectiveEntryType: 'visit' | 'hourly' | 'other' =
    entryType === 'other' ? 'other' : billsByVisit ? entryType : 'hourly';
  const isOther = effectiveEntryType === 'other';
  const calculatedHours = useMemo(() => calculateHours(timeIn, timeOut), [timeIn, timeOut]);
  const overnight = calculatedHours != null && timeIn >= timeOut;

  // Types exist, but none of them are for this discipline — worth saying so
  // explicitly rather than showing the same "none set up" as an empty catalog.
  const hiddenByDiscipline =
    !visitTypesLoading && !visitTypesError && visitTypes.length === 0 && activeCountBeforeFilter > 0;
  // Total visits chosen, counting a line of 2 evals as 2.
  const totalVisits = visitLines.reduce((sum, l) => sum + l.quantity, 0);
  // A mileage-only entry (no visit, no clock times) is the only shape the
  // server lets span a date range.
  const mileageOnly =
    effectiveEntryType === 'hourly' && !timeIn && !timeOut && hasMileage && !!mileage;

  const save = async (action: 'draft' | 'submit') => {
    if (effectiveEntryType === 'visit' && visitLines.length === 0) return;
    // A mileage-only entry has no clock times by design — everything else
    // outside the visit tab still needs them.
    if (effectiveEntryType !== 'visit' && !mileageOnly && (!timeIn || !timeOut)) return;
    if (isOther && !note.trim()) return;

    setSavingAction(action);
    setIsSubmitting(true);
    try {
      if (isEditing && entry) {
        // Editing keeps the entry a draft when "Save draft" is used on a
        // draft; any other save submits (or resubmits) it.
        await updateEntry.mutateAsync({
          id: entry.id,
          data: {
            clientId,
            date: date!,
            ...(effectiveEntryType === 'visit' && visitLines[0]
              ? { visitType: visitLines[0].visitType, quantity: visitLines[0].quantity }
              : {}),
            ...(effectiveEntryType !== 'visit' && timeIn && timeOut ? { timeIn, timeOut } : {}),
            ...(effectiveEntryType === 'hourly' ? { hourKind } : {}),
            ...(mileageAllowed && hasMileage && mileage ? { mileage: parseFloat(mileage) } : {}),
            ...(mileageAllowed && mileageOnly && mileageIsRange && mileageEndDate
              ? { endDate: mileageEndDate }
              : {}),
            ...(!isOther && perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            status: action === 'draft' ? 'draft' : 'submitted',
          },
        });
      } else if (effectiveEntryType === 'visit') {
        // Single atomic batch request — all visit types inserted in one transaction.
        // If anything fails the whole batch rolls back; no partial state.
        await batchCreateEntries.mutateAsync({
          data: {
            employeeId,
            clientId,
            date,
            visits: visitLines,
            ...(mileageAllowed && hasMileage && mileage ? { mileage: parseFloat(mileage) } : {}),
            ...(perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(action === 'draft' ? { status: 'draft' as const } : {}),
          },
        });
      } else {
        await createEntry.mutateAsync({
          data: {
            employeeId,
            clientId,
            date,
            ...(timeIn && timeOut ? { timeIn, timeOut } : {}),
            ...(effectiveEntryType === 'hourly' && hourKind !== 'regular'
              ? { hourKind }
              : {}),
            ...(mileageAllowed && hasMileage && mileage ? { mileage: parseFloat(mileage) } : {}),
            ...(mileageAllowed && mileageOnly && mileageIsRange && mileageEndDate
              ? { endDate: mileageEndDate }
              : {}),
            ...(!isOther && perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(isOther ? { isOther: true } : {}),
            ...(action === 'draft' ? { status: 'draft' as const } : {}),
          },
        });
      }
      queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
      onSubmit(action === 'draft');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : undefined;
      toast({
        title: action === 'draft' ? 'Could not save draft' : 'Could not submit hours',
        description: msg ?? 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await save('submit');
  };

  const canSubmit =
    !!clientId &&
    !!date &&
    (effectiveEntryType === 'visit'
      ? visitLines.length > 0
      : mileageOnly || !!(timeIn && timeOut)) &&
    // A range needs its end date before it can be sent.
    (!mileageIsRange || !mileageOnly || !!mileageEndDate) &&
    (!isOther || !!note.trim()) &&
    !isSubmitting;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit Entry' : 'Log Hours'}</CardTitle>
          <CardDescription>
            {isEditing
              ? entry?.status === 'draft'
                ? 'Finish your draft — save it again or submit it for approval'
                : 'Make your changes — the entry goes back to Molly for approval'
              : 'Submit your time for the week'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Client Selection */}
          <div className="space-y-2">
            <Label htmlFor="client">Client *</Label>
            <select
              id="client"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                // Visit selections belong to the previous client — never
                // carry them over when switching.
                setVisitLines([]);
              }}
              required
              data-testid="select-client"
            >
              <option value="" disabled>
                {clientsLoading ? 'Loading clients...' : 'Select client'}
              </option>
              {(clients ?? []).map((client) => (
                <option key={client.id} value={client.id} data-testid={`select-client-${client.id}`}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="date">Date *</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              data-testid="input-date"
            />
          </div>

          {/* Entry Type Toggle — only clients that bill by visit type (St. Luke's)
              get the Visit/Hourly choice; everyone else logs time in/out. */}
          <Tabs value={effectiveEntryType} onValueChange={(v) => setEntryType(v as 'visit' | 'hourly' | 'other')}>
            {/* "Other" (one-offs like training or meetings) is always available
                on new entries; Visit only for clients that bill by visit type.
                An entry never changes kind between Other and normal, so editing
                an Other entry shows no tabs, and editing a normal entry only
                offers Visit/Hourly. */}
            {!isOther && !isEditing && (
              <TabsList className={`grid w-full ${billsByVisit ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {billsByVisit && <TabsTrigger value="visit" data-testid="tab-visit">Visit</TabsTrigger>}
                <TabsTrigger value="hourly" data-testid="tab-hourly">Hourly</TabsTrigger>
                <TabsTrigger value="other" data-testid="tab-other">Other / one-off</TabsTrigger>
              </TabsList>
            )}
            {!isOther && isEditing && billsByVisit && (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="visit" data-testid="tab-visit">Visit</TabsTrigger>
                <TabsTrigger value="hourly" data-testid="tab-hourly">Hourly</TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="visit" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>
                  Visits *{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    — tap each visit you did; tap again for a second one
                  </span>
                </Label>
                {discipline && !hiddenByDiscipline && (
                  <p className="text-xs text-muted-foreground" data-testid="text-discipline-scope">
                    Showing the visit types for {discipline}.
                  </p>
                )}
                <VisitPicker
                  visitTypes={visitTypes}
                  lines={visitLines}
                  onChange={setVisitLines}
                  labelFor={labelFor}
                  typeFor={typeFor}
                  isLoading={visitTypesLoading}
                  isError={visitTypesError}
                  hiddenByDiscipline={hiddenByDiscipline}
                  discipline={discipline}
                  singleLine={isEditing}
                />
              </div>
            </TabsContent>

            <TabsContent value="other" className="space-y-4 mt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="text-other-explainer">
                For one-offs that aren't a visit or normal hourly work — training,
                meetings, professional development. Molly sets the pay when she
                reviews it.
              </div>
              <div className="space-y-2">
                <Label htmlFor="other-description">What was it? *</Label>
                <Textarea
                  id="other-description"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder='e.g. "3 hours professional development at Weiser School District"'
                  rows={3}
                  data-testid="input-other-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="other-time-in">Time In *</Label>
                  <Input
                    id="other-time-in"
                    type="time"
                    value={timeIn}
                    onChange={(e) => setTimeIn(e.target.value)}
                    data-testid="input-other-time-in"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="other-time-out">Time Out *</Label>
                  <Input
                    id="other-time-out"
                    type="time"
                    value={timeOut}
                    onChange={(e) => setTimeOut(e.target.value)}
                    data-testid="input-other-time-out"
                  />
                </div>
              </div>
              {calculatedHours != null && (
                <p className="text-sm text-muted-foreground">
                  {calculatedHours} hours{overnight ? ' (overnight shift)' : ''}
                </p>
              )}
            </TabsContent>

            <TabsContent value="hourly" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Type of hours</Label>
                <div className="flex flex-wrap gap-2" data-testid="hour-kind">
                  {(
                    [
                      ['regular', 'Regular'],
                      ['on-call', 'On call'],
                      ['call-back', 'Called in'],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={hourKind === value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setHourKind(value)}
                      aria-pressed={hourKind === value}
                      data-testid={`hour-kind-${value}`}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {hourKind === 'call-back' && (
                  <p className="text-xs text-muted-foreground" data-testid="call-back-hint">
                    Called in while on call. Some contracts pay a minimum number of
                    hours for this even if you’re home again sooner.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="time-in">Time In *</Label>
                  <Input
                    id="time-in"
                    type="time"
                    value={timeIn}
                    onChange={(e) => setTimeIn(e.target.value)}
                    data-testid="input-time-in"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time-out">Time Out *</Label>
                  <Input
                    id="time-out"
                    type="time"
                    value={timeOut}
                    onChange={(e) => setTimeOut(e.target.value)}
                    data-testid="input-time-out"
                  />
                </div>
              </div>
              {calculatedHours != null ? (
                <p className="text-sm text-muted-foreground" data-testid="text-calculated-hours">
                  {calculatedHours} hours{overnight ? ' (overnight shift)' : ''}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Clocked in and out more than once today? Submit each stretch as its own entry — they add up.
                  Just reporting mileage? Leave the times empty and fill in the miles below.
                </p>
              )}
            </TabsContent>
          </Tabs>

          {/* Mileage — only offered when the client's contract includes it */}
          {mileageAllowed ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="has-mileage">Mileage?</Label>
                  <p className="text-xs text-muted-foreground">Round-trip miles for this day</p>
                </div>
                <Switch
                  id="has-mileage"
                  checked={hasMileage}
                  onCheckedChange={setHasMileage}
                  data-testid="switch-mileage"
                />
              </div>
              {hasMileage && (
                <>
                  <div className="relative">
                    <Input
                      id="mileage"
                      type="number"
                      step="0.1"
                      min="0"
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value)}
                      placeholder="0"
                      aria-label={mileageIsRange ? 'Total miles for the period' : 'Miles (round trip)'}
                      data-testid="input-mileage"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      miles
                    </span>
                  </div>

                  {/* A mileage total pulled from the client's device covers a
                      period, not a day. Only offered when the entry is mileage
                      on its own — the server won't spread a visit or a shift
                      across a range. */}
                  {mileageOnly && (
                    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="mileage-range">These miles cover a date range</Label>
                          <p className="text-xs text-muted-foreground">
                            For a mileage report you ran for a whole pay period
                          </p>
                        </div>
                        <Switch
                          id="mileage-range"
                          checked={mileageIsRange}
                          onCheckedChange={setMileageIsRange}
                          data-testid="switch-mileage-range"
                        />
                      </div>
                      {mileageIsRange && (
                        <div className="space-y-2">
                          <Label htmlFor="mileage-end-date">Through *</Label>
                          <Input
                            id="mileage-end-date"
                            type="date"
                            value={mileageEndDate}
                            min={date}
                            onChange={(e) => setMileageEndDate(e.target.value)}
                            data-testid="input-mileage-end-date"
                          />
                          <p className="text-xs text-muted-foreground">
                            {mileageEndDate
                              ? `One entry covering ${date} through ${mileageEndDate}.`
                              : 'Pick the last day the report covers.'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="text-no-mileage">
              {selectedClient?.name} doesn't include mileage on their contract.
            </p>
          )}

          {/* Per Diem — never applies to Other one-offs */}
          {!isOther && (
          <div className="space-y-2">
            <Label>Per Diem</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['', 'None'],
                ['first_last', 'First/Last day'],
                ['full', 'Full day'],
              ] as const).map(([value, label]) => (
                <Button
                  key={label}
                  type="button"
                  variant={perDiemType === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPerDiemType(value)}
                  data-testid={`button-perdiem-${value || 'none'}`}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          )}

          {/* Notes — the Other tab already collects the description */}
          {!isOther && (
          <div className="space-y-2">
            <Label htmlFor="note">Notes</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional details about this shift..."
              rows={3}
              data-testid="input-note"
            />
          </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex-1"
            disabled={isSubmitting}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          {/* Drafts: available to signed-in employees on new entries and when
              re-saving an existing draft */}
          {allowDraft && (!isEditing || entry?.status === 'draft') && (
            <Button
              type="button"
              variant="secondary"
              className="flex-1 gap-2"
              disabled={!canSubmit}
              onClick={() => save('draft')}
              data-testid="button-save-draft"
            >
              {isSubmitting && savingAction === 'draft' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {isSubmitting && savingAction === 'draft' ? 'Saving...' : 'Save as draft'}
            </Button>
          )}
          <Button
            type="submit"
            className="flex-1 gap-2"
            disabled={!canSubmit}
            data-testid="button-submit"
          >
            {isSubmitting && savingAction === 'submit' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isSubmitting && savingAction === 'submit'
              ? 'Submitting...'
              : !isEditing && effectiveEntryType === 'visit' && totalVisits > 1
                ? `Submit ${totalVisits} Visits`
                : isEditing && entry?.status !== 'draft'
                  ? 'Save & Resubmit'
                  : 'Submit Hours'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
