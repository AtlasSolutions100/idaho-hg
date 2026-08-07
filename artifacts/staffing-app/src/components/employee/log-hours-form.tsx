import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateTimeEntry,
  useListClients,
  getListTimeEntriesQueryKey,
  type PerDiemType,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { visitTypeLabels, type VisitType } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2 } from 'lucide-react';

interface LogHoursFormProps {
  employeeId?: string;
  onSubmit: () => void;
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

export function LogHoursForm({ employeeId = '1', onSubmit, onCancel }: LogHoursFormProps) {
  const [entryType, setEntryType] = useState<'visit' | 'hourly'>('visit');
  const [clientId, setClientId] = useState('');
  const [visitType, setVisitType] = useState<VisitType | ''>('');
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [hasMileage, setHasMileage] = useState(false);
  const [mileage, setMileage] = useState('');
  const [perDiemType, setPerDiemType] = useState<PerDiemType | ''>('');
  const [note, setNote] = useState('');

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: clients, isLoading: clientsLoading } = useListClients();
  const createEntry = useCreateTimeEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
        onSubmit();
      },
      onError: (error) => {
        toast({
          title: 'Could not submit hours',
          description: error?.message ?? 'Something went wrong. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const selectedClient = (clients ?? []).find((c) => c.id === clientId);
  // Hide (and never submit) mileage for clients whose contract doesn't include it.
  const mileageAllowed = selectedClient ? selectedClient.mileageOnContract : true;
  const calculatedHours = useMemo(() => calculateHours(timeIn, timeOut), [timeIn, timeOut]);
  const overnight = calculatedHours != null && timeIn >= timeOut;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (entryType === 'visit' && !visitType) return;
    if (entryType === 'hourly' && (!timeIn || !timeOut)) return;
    createEntry.mutate({
      data: {
        employeeId,
        clientId,
        date,
        ...(entryType === 'visit' && visitType ? { visitType } : {}),
        ...(entryType === 'hourly' && timeIn && timeOut ? { timeIn, timeOut } : {}),
        ...(mileageAllowed && hasMileage && mileage ? { mileage: parseFloat(mileage) } : {}),
        ...(perDiemType ? { perDiemType } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Log Hours</CardTitle>
          <CardDescription>Submit your time for the week</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Client Selection */}
          <div className="space-y-2">
            <Label htmlFor="client">Client *</Label>
            <Select value={clientId} onValueChange={setClientId} required>
              <SelectTrigger id="client" data-testid="select-client">
                <SelectValue placeholder={clientsLoading ? 'Loading clients...' : 'Select client'} />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map(client => (
                  <SelectItem key={client.id} value={client.id} data-testid={`select-client-${client.id}`}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          {/* Entry Type Toggle */}
          <Tabs value={entryType} onValueChange={(v) => setEntryType(v as 'visit' | 'hourly')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="visit" data-testid="tab-visit">Visit</TabsTrigger>
              <TabsTrigger value="hourly" data-testid="tab-hourly">Hourly</TabsTrigger>
            </TabsList>

            <TabsContent value="visit" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="visit-type">Visit Type *</Label>
                <Select value={visitType} onValueChange={(v) => setVisitType(v as VisitType)} required>
                  <SelectTrigger id="visit-type" data-testid="select-visit-type">
                    <SelectValue placeholder="Select visit type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(visitTypeLabels) as VisitType[]).map(type => (
                      <SelectItem key={type} value={type} data-testid={`select-visit-type-${type}`}>
                        {visitTypeLabels[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="hourly" className="space-y-4 mt-4">
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
                  <p className="text-xs text-muted-foreground">Round-trip miles for this shift</p>
                </div>
                <Switch
                  id="has-mileage"
                  checked={hasMileage}
                  onCheckedChange={setHasMileage}
                  data-testid="switch-mileage"
                />
              </div>
              {hasMileage && (
                <div className="relative">
                  <Input
                    id="mileage"
                    type="number"
                    step="0.1"
                    min="0"
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    placeholder="0"
                    aria-label="Miles (round trip)"
                    data-testid="input-mileage"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    miles
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="text-no-mileage">
              {selectedClient?.name} doesn't include mileage on their contract.
            </p>
          )}

          {/* Per Diem */}
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

          {/* Notes */}
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
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex-1"
            disabled={createEntry.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1 gap-2"
            disabled={
              !clientId ||
              !date ||
              (entryType === 'hourly' && (!timeIn || !timeOut)) ||
              createEntry.isPending
            }
            data-testid="button-submit"
          >
            {createEntry.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {createEntry.isPending ? 'Submitting...' : 'Submit Hours'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
