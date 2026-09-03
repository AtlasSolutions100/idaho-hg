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
import { perDiemTypeLabels } from '@/lib/data';
import { useVisitTypes } from '@/lib/use-visit-types';
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
  // How many of the visit type — Molly's correction path for an employee
  // who logged two evals as one, or the wrong number of 15-minute blocks.
  const [quantity, setQuantity] = useState(String(entry.quantity ?? 1));
  const [perDiemType, setPerDiemType] = useState<string>(entry.perDiemType ?? NONE);
  const [note, setNote] = useState(entry.note ?? '');

  // Visit-type options come from the admin-managed catalog. The entry's current
  // type may have been retired since it was logged — keep it selectable so the
  // dropdown shows the real label and Molly doesn't have to change it.
  const { visitTypes, labelFor, typeFor } = useVisitTypes();
  const selectedType = typeFor(visitType === NONE ? null : visitType);
  const isIncrement = selectedType?.billingUnit === 'increment';
  const visitTypeOptions =
    entry.visitType && !visitTypes.some((t) => t.key === entry.visitType)
      ? [{ key: entry.visitType, label: labelFor(entry.visitType) }, ...visitTypes]
      : visitTypes;

  const updateMutation = useUpdateTimeEntry({
    mutation: {
      onSuccess: () => onSaved(),
      onError: (err) => {
        // The generated client throws ApiError with the parsed body on `data`.
        const message =
          (err as { data?: { message?: string } })?.data?.message ??
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
    const quantityNum = Number(quantity);
    if (visitType !== NONE && (!Number.isInteger(quantityNum) || quantityNum < 1)) {
      onError(
        isIncrement
          ? `Enter a whole number of ${selectedType?.incrementMinutes ?? 15}-minute blocks.`
          : 'Enter a whole number of visits.',
      );
      return;
    }
    updateMutation.mutate({
      id: entry.id,
      data: {
        clientId: entry.clientId,
        date: entry.date,
        ...(entry.endDate ? { endDate: entry.endDate } : {}),
        ...(visitType !== NONE
          ? { visitType: visitType as VisitType, quantity: quantityNum }
          : {}),
        ...(timeIn.trim() ? { timeIn: timeIn.trim() } : {}),
        ...(timeOut.trim() ? { timeOut: timeOut.trim() } : {}),
        // Clock times take precedence server-side; only send hours when no times.
        ...(hoursNum != null && !timeIn.trim() && !timeOut.trim() ? { hours: hoursNum } : {}),
        ...(mileageNum != null && mileageNum > 0 ? { mileage: mileageNum } : {}),
        ...(!entry.isOther && perDiemType !== NONE ? { perDiemType: perDiemType as PerDiemType } : {}),
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
                {visitTypeOptions.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1.5 pt-2">
              <Label htmlFor={`edit-quantity-${entry.id}`}>
                {isIncrement
                  ? `How many ${selectedType?.incrementMinutes ?? 15}-minute blocks`
                  : 'How many visits'}
              </Label>
              <Input
                id={`edit-quantity-${entry.id}`}
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-testid={`input-quantity-${entry.id}`}
              />
            </div>
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
        {/* Per diem never applies to Other one-offs — the server rejects it */}
        {!entry.isOther && (
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
        )}
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor={`edit-note-${entry.id}`}>{entry.isOther ? 'Description (required)' : 'Note'}</Label>
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
