import { useState } from 'react';
import {
  type TimeEntry,
  type VisitType,
  type PerDiemType,
  useUpdateTimeEntry,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { visitTypeLabels, perDiemTypeLabels } from '@/lib/data';
import { Loader2, Save } from 'lucide-react';

const NONE = '__none__';

/**
 * Inline form Molly uses to fix an entry before approving it. Sends a full
 * PATCH (the server replaces editable fields and re-runs every create-time
 * rule), and the server records what changed so the employee can see it.
 */
export function AdminEditEntryForm({
  entry,
  onSaved,
  onCancel,
  onError,
}: {
  entry: TimeEntry;
  onSaved: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [timeIn, setTimeIn] = useState(entry.timeIn ?? '');
  const [timeOut, setTimeOut] = useState(entry.timeOut ?? '');
  const [hours, setHours] = useState(entry.hours != null ? String(entry.hours) : '');
  const [mileage, setMileage] = useState(entry.mileage != null ? String(entry.mileage) : '');
  const [visitType, setVisitType] = useState<string>(entry.visitType ?? NONE);
  const [perDiemType, setPerDiemType] = useState<string>(entry.perDiemType ?? NONE);
  const [note, setNote] = useState(entry.note ?? '');

  const updateMutation = useUpdateTimeEntry({
    mutation: {
      onSuccess: () => onSaved(),
      onError: (err) => {
        const message =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Could not save the changes. Please try again.';
        onError(message);
      },
    },
  });

  const save = () => {
    const mileageNum = mileage.trim() === '' ? undefined : Number(mileage);
    const hoursNum = hours.trim() === '' ? undefined : Number(hours);
    if (mileageNum != null && (Number.isNaN(mileageNum) || mileageNum < 0)) {
      onError('Mileage must be a number of miles (0 or more).');
      return;
    }
    if (hoursNum != null && (Number.isNaN(hoursNum) || hoursNum <= 0)) {
      onError('Hours must be a positive number.');
      return;
    }
    updateMutation.mutate({
      id: entry.id,
      data: {
        clientId: entry.clientId,
        date: entry.date,
        ...(visitType !== NONE ? { visitType: visitType as VisitType } : {}),
        ...(timeIn.trim() ? { timeIn: timeIn.trim() } : {}),
        ...(timeOut.trim() ? { timeOut: timeOut.trim() } : {}),
        // Clock times take precedence server-side; only send hours when no times.
        ...(hoursNum != null && !timeIn.trim() && !timeOut.trim() ? { hours: hoursNum } : {}),
        ...(mileageNum != null && mileageNum > 0 ? { mileage: mileageNum } : {}),
        ...(perDiemType !== NONE ? { perDiemType: perDiemType as PerDiemType } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    });
  };

  return (
    <div className="space-y-4 rounded-md border bg-background p-4" data-testid={`admin-edit-form-${entry.id}`}>
      <div className="text-sm font-medium">
        Fix this entry
        <span className="ml-2 font-normal text-muted-foreground">
          {entry.employeeName} will see what you changed.
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entry.visitType ? (
          <div className="space-y-1.5">
            <Label htmlFor={`edit-visit-type-${entry.id}`}>Visit type</Label>
            <Select value={visitType} onValueChange={setVisitType}>
              <SelectTrigger id={`edit-visit-type-${entry.id}`} data-testid={`select-visit-type-${entry.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(visitTypeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-time-in-${entry.id}`}>Time in</Label>
              <Input
                id={`edit-time-in-${entry.id}`}
                type="time"
                value={timeIn}
                onChange={(e) => setTimeIn(e.target.value)}
                data-testid={`input-time-in-${entry.id}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-time-out-${entry.id}`}>Time out</Label>
              <Input
                id={`edit-time-out-${entry.id}`}
                type="time"
                value={timeOut}
                onChange={(e) => setTimeOut(e.target.value)}
                data-testid={`input-time-out-${entry.id}`}
              />
            </div>
            {!timeIn && !timeOut && (
              <div className="space-y-1.5">
                <Label htmlFor={`edit-hours-${entry.id}`}>Hours</Label>
                <Input
                  id={`edit-hours-${entry.id}`}
                  type="number"
                  min="0"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  data-testid={`input-hours-${entry.id}`}
                />
              </div>
            )}
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`edit-mileage-${entry.id}`}>Mileage</Label>
          <Input
            id={`edit-mileage-${entry.id}`}
            type="number"
            min="0"
            step="1"
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            placeholder="None"
            data-testid={`input-mileage-${entry.id}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`edit-per-diem-${entry.id}`}>Per diem</Label>
          <Select value={perDiemType} onValueChange={setPerDiemType}>
            <SelectTrigger id={`edit-per-diem-${entry.id}`} data-testid={`select-per-diem-${entry.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {Object.entries(perDiemTypeLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor={`edit-note-${entry.id}`}>Note</Label>
          <Textarea
            id={`edit-note-${entry.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="No note"
            data-testid={`input-note-${entry.id}`}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={updateMutation.isPending}
          data-testid={`button-cancel-edit-${entry.id}`}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={updateMutation.isPending}
          className="gap-1.5"
          data-testid={`button-save-edit-${entry.id}`}
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );
}
