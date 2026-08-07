import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListClientRates,
  useUpdateClientRate,
  useListClientRateHistory,
  useCreateClient,
  useCreateClientRate,
  useRemoveClient,
  useListClients,
  useUpdateClientBilling,
  getListClientRatesQueryKey,
  getListClientRateHistoryQueryKey,
  getListClientsQueryKey,
  type ClientRate,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { isDemoId } from '@/lib/demo';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { visitTypeLabels, clientRateTypeLabels, type VisitType } from '@/lib/data';
import { Pencil, Loader2, AlertCircle, History, Plus, Trash2, Clock, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function rateTypeLabel(visitType: string): string {
  if (visitType.startsWith('hourly-')) {
    return `Hourly – ${visitType.slice('hourly-'.length)}`;
  }
  return clientRateTypeLabels[visitType] ?? visitType;
}

function isHourlyRateType(visitType: string): boolean {
  return visitType === 'hourly' || visitType.startsWith('hourly-');
}

export function ClientRatesTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rates, isLoading, isError } = useListClientRates();

  const [editing, setEditing] = useState<ClientRate | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [historyFor, setHistoryFor] = useState<ClientRate | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVisitType, setNewVisitType] = useState<VisitType | ''>('');
  const [newRate, setNewRate] = useState('');
  const [newBillingContact, setNewBillingContact] = useState('');
  const [newBillingAddress, setNewBillingAddress] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Per-client billing contact/address editing (shown on PDF invoices).
  const { data: clientList } = useListClients();
  const [billingFor, setBillingFor] = useState<{ clientId: string; clientName: string } | null>(null);
  const [billingContact, setBillingContact] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [mileageOnContract, setMileageOnContract] = useState(true);
  const [removing, setRemoving] = useState<{ clientId: string; clientName: string } | null>(null);

  const [hourlyFor, setHourlyFor] = useState<{ clientId: string; clientName: string } | null>(null);
  const [hourlyRate, setHourlyRate] = useState('');
  const [hourlyDate, setHourlyDate] = useState('');
  const [hourlyError, setHourlyError] = useState<string | null>(null);

  const historyQuery = useListClientRateHistory(historyFor?.id ?? '', {
    query: {
      enabled: !!historyFor,
      queryKey: getListClientRateHistoryQueryKey(historyFor?.id ?? ''),
    },
  });

  const updateMutation = useUpdateClientRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientRatesQueryKey() });
        setEditing(null);
        toast({
          title: 'Rate updated',
          description: 'The new rate was saved. Earlier entries keep the old rate.',
        });
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

  const invalidateClients = () => {
    queryClient.invalidateQueries({ queryKey: getListClientRatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
  };

  const createMutation = useCreateClient({
    mutation: {
      onSuccess: (client) => {
        invalidateClients();
        setAddOpen(false);
        toast({
          title: 'Client added',
          description: `${client.name} is now available for logging hours.`,
        });
      },
      onError: (error) => {
        const serverMessage =
          error && typeof error === 'object' && 'data' in error &&
          error.data && typeof error.data === 'object' && 'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : null;
        setAddError(serverMessage ?? 'Could not add the client. Please check the details and try again.');
      },
    },
  });

  const removeMutation = useRemoveClient({
    mutation: {
      onSuccess: (client) => {
        invalidateClients();
        setRemoving(null);
        toast({
          title: 'Client removed',
          description: `${client.name} was removed. Past time entries are kept.`,
        });
      },
      onError: () => {
        toast({
          title: 'Could not remove client',
          description: 'Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const billingMutation = useUpdateClientBilling({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        setBillingFor(null);
        toast({
          title: 'Billing details saved',
          description: 'PDF invoices for this client will now show them in the Bill to section.',
        });
      },
      onError: () => {
        toast({
          title: 'Could not save billing details',
          description: 'Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const openBilling = (clientId: string, clientName: string) => {
    const client = (clientList ?? []).find((c) => c.id === clientId);
    setBillingContact(client?.billingContact ?? '');
    setBillingAddress(client?.billingAddress ?? '');
    setMileageOnContract(client?.mileageOnContract ?? true);
    setBillingFor({ clientId, clientName });
  };

  const createRateMutation = useCreateClientRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientRatesQueryKey() });
        setHourlyFor(null);
        toast({
          title: 'Hourly rate added',
          description: 'Hourly time entries for this client will now be billed on invoices.',
        });
      },
      onError: (error) => {
        const serverMessage =
          error && typeof error === 'object' && 'data' in error &&
          error.data && typeof error.data === 'object' && 'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : null;
        setHourlyError(serverMessage ?? 'Could not save the hourly rate. Please try again.');
      },
    },
  });

  const openAddHourly = (clientId: string, clientName: string) => {
    setHourlyRate('');
    setHourlyDate(new Date().toISOString().slice(0, 10));
    setHourlyError(null);
    setHourlyFor({ clientId, clientName });
  };

  const handleAddHourly = () => {
    if (!hourlyFor) return;
    setHourlyError(null);
    const parsedRate = Number(hourlyRate);
    if (!hourlyRate || !Number.isFinite(parsedRate) || parsedRate < 0) {
      setHourlyError('Enter a valid dollar amount.');
      return;
    }
    if (!hourlyDate) {
      setHourlyError('Choose an effective date.');
      return;
    }
    createRateMutation.mutate({
      data: {
        clientId: hourlyFor.clientId,
        rateType: 'hourly',
        rate: parsedRate,
        effectiveDate: hourlyDate,
      },
    });
  };

  const openAdd = () => {
    setNewName('');
    setNewVisitType('');
    setNewRate('');
    setNewBillingContact('');
    setNewBillingAddress('');
    setAddError(null);
    setAddOpen(true);
  };

  const handleAdd = () => {
    setAddError(null);
    const parsedRate = Number(newRate);
    if (!newName.trim()) {
      toast({ title: 'Missing name', description: 'Enter the client name.', variant: 'destructive' });
      return;
    }
    if (!newVisitType) {
      toast({ title: 'Missing visit type', description: 'Choose a visit type.', variant: 'destructive' });
      return;
    }
    if (!newRate || !Number.isFinite(parsedRate) || parsedRate < 0) {
      toast({ title: 'Invalid rate', description: 'Enter a valid dollar amount.', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      data: {
        name: newName.trim(),
        visitType: newVisitType,
        rate: parsedRate,
        ...(newBillingContact.trim() ? { billingContact: newBillingContact.trim() } : {}),
        ...(newBillingAddress.trim() ? { billingAddress: newBillingAddress.trim() } : {}),
      },
    });
  };

  const openEdit = (rate: ClientRate) => {
    setEditing(rate);
    setRateValue(rate.rate.toString());
    setEffectiveDate(new Date().toISOString().slice(0, 10));
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
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Client Rates</CardTitle>
          <CardDescription>
            Billing rates by client and visit type
          </CardDescription>
        </div>
        <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-client">
          <Plus className="h-4 w-4" />
          Add Client
        </Button>
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
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{clientRates[0].clientName}</h3>
                    {isDemoId(clientId) && (
                      <Badge variant="outline" className="text-xs font-normal">Demo</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!clientRates.some((r) => r.visitType === 'hourly') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-2"
                        onClick={() => openAddHourly(clientId, clientRates[0].clientName)}
                        data-testid={`button-add-hourly-rate-${clientId}`}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        Add Hourly Rate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-2"
                      onClick={() => openBilling(clientId, clientRates[0].clientName)}
                      data-testid={`button-edit-billing-${clientId}`}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Billing Details
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => setRemoving({ clientId, clientName: clientRates[0].clientName })}
                      data-testid={`button-remove-client-${clientId}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate Type</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Effective Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientRates.map(rate => (
                        <TableRow key={rate.id} data-testid={`client-rate-${rate.id}`}>
                          <TableCell>{rateTypeLabel(rate.visitType)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            ${rate.rate.toFixed(2)}
                            <span className="text-xs text-muted-foreground font-sans">
                              {isHourlyRateType(rate.visitType) ? ' /hr' : ' /visit'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {rate.effectiveDate}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-2"
                                onClick={() => setHistoryFor(rate)}
                                data-testid={`button-history-client-rate-${rate.id}`}
                              >
                                <History className="h-3.5 w-3.5" />
                                History
                              </Button>
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
                            </div>
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Client</DialogTitle>
            <DialogDescription>
              The client will appear right away in rate lists and the Log Hours form.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-client-name">Client Name</Label>
              <Input
                id="new-client-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Boise Family Clinic"
                data-testid="input-new-client-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-visit-type">Visit Type</Label>
              <Select value={newVisitType} onValueChange={(v) => setNewVisitType(v as VisitType)}>
                <SelectTrigger id="new-client-visit-type" data-testid="select-new-client-visit-type">
                  <SelectValue placeholder="Select visit type" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(visitTypeLabels) as VisitType[]).map(type => (
                    <SelectItem key={type} value={type} data-testid={`select-new-client-visit-type-${type}`}>
                      {visitTypeLabels[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-rate">Rate ($ per visit)</Label>
              <Input
                id="new-client-rate"
                type="number"
                min="0"
                step="0.01"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="95.00"
                data-testid="input-new-client-rate"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-billing-contact">Billing Contact (optional)</Label>
              <Input
                id="new-client-billing-contact"
                value={newBillingContact}
                onChange={(e) => setNewBillingContact(e.target.value)}
                placeholder="e.g. Rosie Rios"
                data-testid="input-new-client-billing-contact"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-billing-address">Billing Address (optional)</Label>
              <Textarea
                id="new-client-billing-address"
                value={newBillingAddress}
                onChange={(e) => setNewBillingAddress(e.target.value)}
                placeholder={'5465 W Irving Street\nBoise, ID 83706'}
                rows={3}
                data-testid="input-new-client-billing-address"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the "Bill to" section of PDF invoices, like QuickBooks.
              </p>
            </div>
            {addError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-add-client"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{addError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add-client">
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              className="gap-2"
              data-testid="button-save-add-client"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Client</DialogTitle>
            <DialogDescription>
              {removing
                ? `Remove ${removing.clientName}? They will disappear from rate lists and the Log Hours form. All past time entries and rate history are kept.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} data-testid="button-cancel-remove-client">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removing && removeMutation.mutate({ id: removing.clientId })}
              disabled={removeMutation.isPending}
              className="gap-2"
              data-testid="button-confirm-remove-client"
            >
              {removeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!billingFor} onOpenChange={(open) => !open && setBillingFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Billing Details</DialogTitle>
            <DialogDescription>
              {billingFor
                ? `${billingFor.clientName} — the contact and address appear in the "Bill to" section of PDF invoices. Leave blank to show the client name only.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="billing-contact">Billing Contact (optional)</Label>
              <Input
                id="billing-contact"
                value={billingContact}
                onChange={(e) => setBillingContact(e.target.value)}
                placeholder="e.g. Rosie Rios"
                data-testid="input-billing-contact"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billing-address">Billing Address (optional)</Label>
              <Textarea
                id="billing-address"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder={'5465 W Irving Street\nBoise, ID 83706'}
                rows={3}
                data-testid="input-billing-address"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="mileage-on-contract">Mileage on contract</Label>
                <p className="text-xs text-muted-foreground">
                  When off, employees can't submit mileage for this client.
                </p>
              </div>
              <Switch
                id="mileage-on-contract"
                checked={mileageOnContract}
                onCheckedChange={setMileageOnContract}
                data-testid="switch-mileage-on-contract"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillingFor(null)} data-testid="button-cancel-billing">
              Cancel
            </Button>
            <Button
              onClick={() =>
                billingFor &&
                billingMutation.mutate({
                  id: billingFor.clientId,
                  data: { billingContact, billingAddress, mileageOnContract },
                })
              }
              disabled={billingMutation.isPending}
              className="gap-2"
              data-testid="button-save-billing"
            >
              {billingMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Client Rate</DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.clientName} — ${rateTypeLabel(editing.visitType)}. The new rate applies from the effective date; earlier entries keep the old rate.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-rate">
                {editing && isHourlyRateType(editing.visitType) ? 'Rate ($ per hour)' : 'Rate ($ per visit)'}
              </Label>
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

      <Dialog open={!!hourlyFor} onOpenChange={(open) => !open && setHourlyFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Hourly Rate</DialogTitle>
            <DialogDescription>
              {hourlyFor
                ? `${hourlyFor.clientName} — hourly time entries will be billed at this rate on invoices from the effective date.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hourly-rate">Rate ($ per hour)</Label>
              <Input
                id="hourly-rate"
                type="number"
                min="0"
                step="0.01"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="65.00"
                data-testid="input-hourly-rate"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hourly-rate-date">Effective Date</Label>
              <Input
                id="hourly-rate-date"
                type="date"
                value={hourlyDate}
                onChange={(e) => setHourlyDate(e.target.value)}
                data-testid="input-hourly-rate-date"
              />
            </div>
            {hourlyError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-add-hourly-rate"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{hourlyError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHourlyFor(null)} data-testid="button-cancel-hourly-rate">
              Cancel
            </Button>
            <Button
              onClick={handleAddHourly}
              disabled={createRateMutation.isPending}
              className="gap-2"
              data-testid="button-save-hourly-rate"
            >
              {createRateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyFor} onOpenChange={(open) => !open && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rate History</DialogTitle>
            <DialogDescription>
              {historyFor
                ? `${historyFor.clientName} — ${clientRateTypeLabels[historyFor.visitType] ?? historyFor.visitType}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {historyQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : historyQuery.isError ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Couldn't load rate history.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective Date</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(historyQuery.data ?? []).map((row, index) => (
                  <TableRow key={row.id} data-testid={`client-rate-history-${row.id}`}>
                    <TableCell className="font-mono text-sm">
                      {row.effectiveDate}
                      {index === 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">${row.rate.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
