import type { VisitTypeItem } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, Minus, Plus, X } from 'lucide-react';

/** One chosen visit line: a visit type and how many of it. */
export interface VisitLine {
  visitType: string;
  /** Visits, or 15-minute blocks for an increment-billed type. */
  quantity: number;
}

/** Blocks -> "30 min" / "1 hr 15 min", so the employee thinks in time, not units. */
export function formatDuration(blocks: number, minutesPerBlock: number): string {
  const total = blocks * minutesPerBlock;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

interface VisitPickerProps {
  visitTypes: VisitTypeItem[];
  lines: VisitLine[];
  onChange: (lines: VisitLine[]) => void;
  labelFor: (key: string | null | undefined) => string;
  typeFor: (key: string | null | undefined) => VisitTypeItem | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Types exist but none apply to this discipline — a different message. */
  hiddenByDiscipline: boolean;
  discipline?: string | null;
  /** Editing an existing entry: exactly one line, no adding more. */
  singleLine?: boolean;
}

/**
 * The visit chooser. Tapping a type adds it to the day; tapping it again adds
 * another of the same, so "two evals and a discharge" is two taps on Eval and
 * one on Discharge. Chosen visits appear above the list with their count and a
 * +/- so a mis-tap is fixable without starting over.
 *
 * A type billed in blocks (Hospital at Home, drive time) shows a duration
 * instead of a count, because the employee knows they drove half an hour, not
 * that they drove two blocks.
 */
export function VisitPicker({
  visitTypes,
  lines,
  onChange,
  labelFor,
  typeFor,
  isLoading,
  isError,
  hiddenByDiscipline,
  discipline,
  singleLine = false,
}: VisitPickerProps) {
  const add = (key: string) => {
    if (singleLine) {
      onChange([{ visitType: key, quantity: 1 }]);
      return;
    }
    const existing = lines.find((l) => l.visitType === key);
    if (existing) {
      onChange(
        lines.map((l) =>
          l.visitType === key ? { ...l, quantity: Math.min(l.quantity + 1, 100) } : l,
        ),
      );
    } else {
      onChange([...lines, { visitType: key, quantity: 1 }]);
    }
  };

  const setQuantity = (key: string, quantity: number) => {
    if (quantity <= 0) {
      onChange(lines.filter((l) => l.visitType !== key));
      return;
    }
    onChange(
      lines.map((l) => (l.visitType === key ? { ...l, quantity: Math.min(quantity, 100) } : l)),
    );
  };

  const remove = (key: string) => onChange(lines.filter((l) => l.visitType !== key));

  return (
    <div className="space-y-2">
      {/* What's been chosen so far, with counts. */}
      {lines.length > 0 && (
        <div className="space-y-2 mb-2" data-testid="selected-visit-types">
          {lines.map((line) => {
            const type = typeFor(line.visitType);
            const isIncrement = type?.billingUnit === 'increment';
            const perBlock = type?.incrementMinutes ?? 15;
            return (
              <div
                key={line.visitType}
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2"
                data-testid={`visit-line-${line.visitType}`}
              >
                <span className="flex-1 text-sm font-medium">{labelFor(line.visitType)}</span>
                {!singleLine && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setQuantity(line.visitType, line.quantity - 1)}
                      aria-label={`One fewer ${labelFor(line.visitType)}`}
                      data-testid={`visit-minus-${line.visitType}`}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span
                      className="min-w-[5.5rem] text-center text-sm tabular-nums"
                      data-testid={`visit-quantity-${line.visitType}`}
                    >
                      {isIncrement
                        ? formatDuration(line.quantity, perBlock)
                        : `${line.quantity} ${line.quantity === 1 ? 'visit' : 'visits'}`}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setQuantity(line.visitType, line.quantity + 1)}
                      aria-label={`One more ${labelFor(line.visitType)}`}
                      data-testid={`visit-plus-${line.visitType}`}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => remove(line.visitType)}
                  aria-label={`Remove ${labelFor(line.visitType)}`}
                  data-testid={`visit-remove-${line.visitType}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* The catalog to pick from. */}
      <div
        className="rounded-md border border-input max-h-64 overflow-y-auto divide-y divide-border"
        data-testid="visit-type-list"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading visit types…
          </div>
        ) : isError ? (
          // Distinct from "none configured": a failed request used to render
          // the empty state below, which read as "Molly hasn't set any up".
          <div className="px-3 py-6 text-center text-sm text-destructive">
            Couldn’t load the visit types. Check your connection and refresh — if
            this keeps happening, send feedback.
          </div>
        ) : visitTypes.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {hiddenByDiscipline
              ? `No visit types are set up for ${discipline} yet. Ask Molly to add one.`
              : 'No visit types are set up yet.'}
          </div>
        ) : (
          visitTypes.map((item) => {
            const line = lines.find((l) => l.visitType === item.key);
            const chosen = !!line;
            const isIncrement = item.billingUnit === 'increment';
            return (
              <button
                key={item.key}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-muted ${
                  chosen ? 'bg-primary/10 font-medium' : ''
                }`}
                onClick={() => add(item.key)}
                data-testid={`select-visit-type-${item.key}`}
                aria-pressed={chosen}
              >
                <span className="flex-shrink-0 h-4 w-4 rounded border flex items-center justify-center border-input">
                  <Plus className="h-3 w-3" />
                </span>
                <span className="flex-1">{labelFor(item.key)}</span>
                {isIncrement && (
                  <span className="text-xs text-muted-foreground">
                    hourly
                  </span>
                )}
                {chosen && !singleLine && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ×{line!.quantity}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {!singleLine && lines.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="visit-picker-hint">
          Tap a visit type again to add another one. Mileage and per diem attach
          to the first visit so they're never counted twice.
        </p>
      )}
    </div>
  );
}
