import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListClientRates,
  useUpdateClientRate,
  getListClientRatesQueryKey,
  type ClientRate,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { visitTypeLabels, type VisitType } from '@/lib/data';
import { Pencil, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ClientRatesTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rates, isLoading, isError } = useListClientRates();

  const [editing, setEditing] = useState<ClientRate | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');

  const updateMutation = useUpdateClientRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientRatesQueryKey() });
        setEditing(null);
        toast({ title: 'Rate updated', description: 'The client rate has been saved.' });
      },
      onError: () => {
        toast({
          title: 'Update failed',
          description: 'Could not save the rate. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const openEdit = (rate: ClientRate) => {
    setEditing(rate);
    setRateValue(rate.rate.toString());
    setEffectiveDate(rate.effectiveDate);
  };

  const handleSave = () => {
    if (!editing) return;
    const parsedRate = Number(rateValue);
    if (!Number.isFinite(parsedRate) || parsedRate < 0) {
      toast({
        title: 'Invalid rate',
        description: 'Enter a valid dollar amount.',
        variant: 'destructive',
      });
      return;
    }
    if (!effectiveDate) {
      toast({
        title: 'Missing date',
        description: 'Choose an effective date.',
        variant: 'destructive',
      });
      return;
    }
    updateMutation.mutate({
      id: editing.id,
      data: { rate: parsedRate, effectiveDate },
    });
  };

  // Group by client
  const clientGroups = (rates ?? []).reduce((acc, rate) => {
    if (!acc[rate.clientId]) {
      acc[rate.clientId] = [];
    }
    acc[rate.clientId].push(rate);
    return acc;
  }, {} as Record<string, ClientRate[]>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Rates</CardTitle>
        <CardDescription>
          Billing rates by client and visit type
        </CardDescription>
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
            <p>Couldn't load client rates.</p>
            <p className="text-sm mt-1">Please try refreshing the page.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(clientGroups).map(([clientId, clientRates]) => (
              <div key={clientId}>
                <h3 className="font-medium mb-3">{clientRates[0].clientName}</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Visit Type</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Effective Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientRates.map(rate => (
                        <TableRow key={rate.id} data-testid={`client-rate-${rate.id}`}>
                          <TableCell>{visitTypeLabels[rate.visitType as VisitType] ?? rate.visitType}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            ${rate.rate.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {rate.effectiveDate}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-2"
                              onClick={() => openEdit(rate)}
                              data-testid={`button-edit-client-rate-${rate.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Client Rate</DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.clientName} — ${visitTypeLabels[editing.visitType as VisitType] ?? editing.visitType}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-rate">Rate ($ per visit)</Label>
              <Input
                id="client-rate"
                type="number"
                min="0"
                step="0.01"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                data-testid="input-client-rate"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-rate-date">Effective Date</Label>
              <Input
                id="client-rate-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                data-testid="input-client-rate-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="button-cancel-client-rate">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="gap-2"
              data-testid="button-save-client-rate"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
