import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListVisitPayRates,
  useListEmployees,
  useCreateVisitPayRate,
  useUpdateVisitPayRate,
  getListVisitPayRatesQueryKey,
} from '@workspace/api-client-react';
import type { VisitPayRate } from '@workspace/api-client-react';
import { useVisitTypes } from '@/lib/use-visit-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, Check, Loader2 } from 'lucide-react';

// Disciplines fall back to this known set when the roster hasn't loaded.
const FALLBACK_DISCIPLINES = ['RN', 'PT', 'OT', 'SLP', 'PTA', 'LCSW'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const cellKey = (discipline: string, visitType: string) => `${discipline}::${visitType}`;

export default function VisitPayRatesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { visitTypes, isLoading: typesLoading } = useVisitTypes();
  const { data: payRates, isLoading: ratesLoading } = useListVisitPayRates();
  const { data: employees } = useListEmployees();

  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // Disciplines that actually exist on the roster, plus any that already have a
  // pay rate — so nothing Molly has entered ever disappears from the grid.
  const disciplines = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees ?? []) if (e.role) set.add(e.role);
    for (const r of payRates ?? []) set.add(r.discipline);
    if (set.size === 0) FALLBACK_DISCIPLINES.forEach((d) => set.add(d));
    return [...set].sort();
  }, [employees, payRates]);

  // Current rate per (discipline, visitType).
  const current = useMemo(() => {
    const map = new Map<string, VisitPayRate>();
    for (const r of payRates ?? []) map.set(cellKey(r.discipline, r.visitType), r);
    return map;
  }, [payRates]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVisitPayRatesQueryKey() });

  const createMutation = useCreateVisitPayRate();
  const updateMutation = useUpdateVisitPayRate();

  async function saveCell(discipline: string, visitType: string, raw: string) {
    const key = cellKey(discipline, visitType);
    const existing = current.get(key);
    const trimmed = raw.trim();

    // Empty + nothing stored yet -> nothing to do.
    if (trimmed === '' && !existing) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      return;
    }
    const value = Number(trimmed);
    if (trimmed === '' || Number.isNaN(value) || value < 0) {
      toast({
        title: 'Enter a dollar amount',
        description: `"${raw}" isn't a valid pay rate.`,
        variant: 'destructive',
      });
      return;
    }
    // Unchanged -> skip.
    if (existing && existing.rate === value) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      return;
    }

    setSavingKey(key);
    try {
      if (existing) {
        await updateMutation.mutateAsync({ id: existing.id, data: { rate: value, effectiveDate } });
      } else {
        await createMutation.mutateAsync({ data: { discipline, visitType, rate: value, effectiveDate } });
      }
      await invalidate();
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast({
        title: 'Could not save',
        description: `Failed to save the ${discipline} rate for this visit type. Try again.`,
        variant: 'destructive',
      });
    } finally {
      setSavingKey((k) => (k === key ? null : k));
    }
  }

  const loading = typesLoading || ratesLoading;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold">Visit Pay Rates</h1>
              <p className="text-sm text-muted-foreground">
                What each discipline is paid per visit type (St. Luke’s)
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6" data-testid="visit-pay-rates-content">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-1">
          <p>
            Enter the dollar amount each discipline is paid for one visit of each
            type. This is the <strong>pay</strong> matrix from your rate sheet
            (e.g. an RN Start of Care). It’s separate from what you bill the client
            (Client Rates) and from an employee’s flat hourly/visit rate on the
            Employees page.
          </p>
          <p>
            A blank cell falls back to the employee’s flat visit rate. Each change
            is saved with an effective date, so past payroll keeps the old rate.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="effective-date">Effective date for edits</Label>
            <Input
              id="effective-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-44"
              data-testid="input-effective-date"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : visitTypes.length === 0 ? (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            No visit types yet. Add them on the{' '}
            <Link href="/admin/visit-types" className="underline">Visit Types</Link> page first.
          </div>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm" data-testid="pay-matrix">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium px-4 py-3 sticky left-0 bg-muted/50 min-w-[16rem]">
                    Visit type
                  </th>
                  {disciplines.map((d) => (
                    <th key={d} className="text-right font-medium px-4 py-3 min-w-[7rem]">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visitTypes.map((vt) => (
                  <tr key={vt.key} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 sticky left-0 bg-background">
                      <div className="font-medium">{vt.label}</div>
                      <div className="text-xs text-muted-foreground">{vt.abbreviation}</div>
                    </td>
                    {disciplines.map((d) => {
                      const key = cellKey(d, vt.key);
                      const existing = current.get(key);
                      const value = drafts[key] ?? (existing ? String(existing.rate) : '');
                      return (
                        <td key={d} className="px-2 py-1.5">
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                              $
                            </span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={value}
                              placeholder="—"
                              aria-label={`${d} pay for ${vt.label}`}
                              data-testid={`rate-${d}-${vt.key}`}
                              onChange={(e) =>
                                setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              onBlur={(e) => saveCell(d, vt.key, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              }}
                              className="h-9 pl-5 pr-7 text-right tabular-nums"
                            />
                            {savingKey === key && (
                              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            {savedKey === key && (
                              <Check className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-600" />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
