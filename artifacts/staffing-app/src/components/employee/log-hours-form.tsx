import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateTimeEntry,
  getListTimeEntriesQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { mockClients, visitTypeLabels, type VisitType } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2 } from 'lucide-react';

interface LogHoursFormProps {
  employeeId?: string;
  onSubmit: () => void;
  onCancel: () => void;
}

export function LogHoursForm({ employeeId = '1', onSubmit, onCancel }: LogHoursFormProps) {
  const [entryType, setEntryType] = useState<'visit' | 'hourly'>('visit');
  const [clientId, setClientId] = useState('');
  const [visitType, setVisitType] = useState<VisitType | ''>('');
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [mileage, setMileage] = useState('');
  const [perDiem, setPerDiem] = useState('0');
  const [isWeekend, setIsWeekend] = useState(false);
  const [isHoliday, setIsHoliday] = useState(false);
  const [note, setNote] = useState('');

  const { toast } = useToast();
  const queryClient = useQueryClient();
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (entryType === 'visit' && !visitType) return;
    if (entryType === 'hourly' && !hours) return;
    createEntry.mutate({
      data: {
        employeeId,
        clientId,
        date,
        ...(entryType === 'visit' && visitType ? { visitType } : {}),
        ...(entryType === 'hourly' && hours ? { hours: parseFloat(hours) } : {}),
        ...(mileage ? { mileage: parseFloat(mileage) } : {}),
        ...(perDiem && parseFloat(perDiem) > 0 ? { perDiem: parseFloat(perDiem) } : {}),
        isWeekend,
        isHoliday,
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
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {mockClients.filter(c => c.active).map(client => (
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
              <div className="space-y-2">
                <Label htmlFor="hours">Hours *</Label>
                <Input
                  id="hours"
                  type="number"
                  step="0.25"
                  min="0"
                  max="24"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="8.0"
                  required
                  data-testid="input-hours"
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Mileage */}
          <div className="space-y-2">
            <Label htmlFor="mileage">Mileage (round trip)</Label>
            <div className="relative">
              <Input
                id="mileage"
                type="number"
                step="0.1"
                min="0"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="0"
                data-testid="input-mileage"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                miles
              </span>
            </div>
          </div>

          {/* Per Diem */}
          <div className="space-y-2">
            <Label htmlFor="per-diem">Per Diem Days</Label>
            <Input
              id="per-diem"
              type="number"
              min="0"
              max="1"
              step="0.5"
              value={perDiem}
              onChange={(e) => setPerDiem(e.target.value)}
              data-testid="input-per-diem"
            />
            <p className="text-xs text-muted-foreground">
              Enter 0.5 for half day, 1 for full day
            </p>
          </div>

          {/* Weekend / Holiday Flags */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="weekend">Weekend Rate</Label>
                <p className="text-xs text-muted-foreground">1.5x pay multiplier</p>
              </div>
              <Switch
                id="weekend"
                checked={isWeekend}
                onCheckedChange={setIsWeekend}
                data-testid="switch-weekend"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="holiday">Holiday Rate</Label>
                <p className="text-xs text-muted-foreground">2.0x pay multiplier</p>
              </div>
              <Switch
                id="holiday"
                checked={isHoliday}
                onCheckedChange={setIsHoliday}
                data-testid="switch-holiday"
              />
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
            disabled={!clientId || !date || createEntry.isPending}
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
