import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListTravelAllowances,
  useCreateTravelAllowance,
  useUpdateTravelAllowance,
  useListEmployees,
  useListClients,
  getListTravelAllowancesQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ThemeToggle } from '@/components/theme-toggle';
import { LoadFailure } from '@/components/load-failure';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, Loader2, Plus, Check } from 'lucide-react';

/**
 * Per-day travel allowances: what an employee is paid for working at one of a
 * client's clinics, instead of mileage.
 *
 * Stored as billable round-trip miles rather than dollars, because the money
 * is miles x the mileage rate and Molly's rates follow GSA. Entering dollars
 * would freeze each allowance at today's rate and go quietly wrong the next
 * time the rate moves.
 */
export default function TravelAllowancesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const allowances = useListTravelAllowances();
  const { data: employees } = useListEmployees();
  const { data: clients } = useListClients();

  const [employeeId, setEmployeeId] = useState('');
  const [clientId, setClientId] = useState('');
  const [location, setLocation] = useState('');
  const [miles, setMiles] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editMiles, setEditMiles] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListTravelAllowancesQueryKey() });

  const create = useCreateTravelAllowance({
    mutation: {
      onSuccess: () => {
        invalidate();
        setLocation('');
        setMiles('');
        toast({ title: 'Allowance saved' });
      },
      onError: () =>
        toast({
          title: 'Could not save that allowance',
          description: 'Check the employee, client and miles, then try again.',
          variant: 'destructive',
        }),
    },
  });

  const update = useUpdateTravelAllowance({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditing(null);
        toast({
          title: 'Allowance updated',
          description: 'Periods already paid keep the old figure.',
        });
      },
      onError: () =>
        toast({ title: 'Could not update that allowance', variant: 'destructive' }),
    },
  });

  const canAdd = employeeId && clientId && location.trim() && Number(miles) > 0;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="bg-card border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-semibold">Travel Allowances</h1>
              <p className="text-sm text-muted-foreground">
                Paid per day worked at a clinic, instead of mileage
              </p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          Enter the <strong className="text-foreground">round-trip miles</strong> you
          bill for one day at that clinic — already less any miles your contract
          deducts. The dollar amount is worked out from the mileage rate in
          effect, so it follows the rate instead of going stale.
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-medium">Add an allowance</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger data-testid="select-employee">
                  <SelectValue placeholder="Pick someone" />
                </SelectTrigger>
                <SelectContent>
                  {(employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger data-testid="select-client">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Clinic location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Fruitland"
                data-testid="input-location"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="miles">Round-trip miles</Label>
              <Input
                id="miles"
                type="number"
                min="0"
                step="0.1"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                data-testid="input-miles"
              />
            </div>
          </div>
          <Button
            onClick={() =>
              create.mutate({
                data: {
                  employeeId,
                  clientId,
                  location: location.trim(),
                  miles: Number(miles),
                },
              })
            }
            disabled={!canAdd || create.isPending}
            className="gap-2"
            data-testid="button-add-allowance"
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add allowance
          </Button>
        </div>

        {allowances.isError ? (
          <LoadFailure
            what="travel allowances"
            error={allowances.error}
            onRetry={() => void allowances.refetch()}
          />
        ) : allowances.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading allowances…</p>
        ) : (allowances.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-allowances">
            No travel allowances yet. Add one above and it will show on invoices
            as its own line.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium text-right">Miles / day</th>
                  <th className="px-4 py-2 font-medium">Since</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {(allowances.data ?? []).map((a) => (
                  <tr key={a.id} className="border-t" data-testid={`allowance-${a.id}`}>
                    <td className="px-4 py-2">{a.employeeName}</td>
                    <td className="px-4 py-2">{a.clientName}</td>
                    <td className="px-4 py-2">{a.location}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {editing === a.id ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          value={editMiles}
                          onChange={(e) => setEditMiles(e.target.value)}
                          className="h-8 w-24 ml-auto text-right"
                          data-testid="input-edit-miles"
                        />
                      ) : (
                        a.miles
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{a.effectiveDate}</td>
                    <td className="px-4 py-2 text-right">
                      {editing === a.id ? (
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={update.isPending || !(Number(editMiles) > 0)}
                          onClick={() =>
                            update.mutate({ id: a.id, data: { miles: Number(editMiles) } })
                          }
                          data-testid="button-save-miles"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Save
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(a.id);
                            setEditMiles(String(a.miles));
                          }}
                          data-testid="button-edit-miles"
                        >
                          Change
                        </Button>
                      )}
                    </td>
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
