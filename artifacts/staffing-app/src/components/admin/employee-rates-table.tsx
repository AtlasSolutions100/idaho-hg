import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployeeRates,
  useUpdateEmployeeRate,
  useListEmployeeRateHistory,
  useCreateEmployee,
  useRemoveEmployee,
  getListEmployeeRatesQueryKey,
  getListEmployeeRateHistoryQueryKey,
  getListEmployeesQueryKey,
  type EmployeeRate,
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
import { Pencil, Loader2, AlertCircle, History, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface EditForm {
  hourlyRate: string;
  visitRate: string;
  mileageRate: string;
  perDiemRate: string;
  weekendMultiplier: string;
  holidayMultiplier: string;
  effectiveDate: string;
}

const numericFields: Array<{
  key: keyof Omit<EditForm, 'effectiveDate'>;
  label: string;
  step: string;
  min: number;
}> = [
  { key: 'hourlyRate', label: 'Hourly Rate ($)', step: '0.01', min: 0 },
  { key: 'visitRate', label: 'Visit Rate ($)', step: '0.01', min: 0 },
  { key: 'mileageRate', label: 'Mileage Rate ($/mi)', step: '0.001', min: 0 },
  { key: 'perDiemRate', label: 'Per Diem Rate ($)', step: '0.01', min: 0 },
  { key: 'weekendMultiplier', label: 'Weekend Multiplier', step: '0.1', min: 1 },
  { key: 'holidayMultiplier', label: 'Holiday Multiplier', step: '0.1', min: 1 },
];

export function EmployeeRatesTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rates, isLoading, isError } = useListEmployeeRates();

  const [editing, setEditing] = useState<EmployeeRate | null>(null);
  const [form, setForm] = useState<EditForm>({
    hourlyRate: '',
    visitRate: '',
    mileageRate: '',
    perDiemRate: '',
    weekendMultiplier: '',
    holidayMultiplier: '',
    effectiveDate: '',
  });
  const [historyFor, setHistoryFor] = useState<EmployeeRate | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRates, setNewRates] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<{ employeeId: string; employeeName: string } | null>(null);

  const historyQuery = useListEmployeeRateHistory(historyFor?.id ?? '', {
    query: {
      enabled: !!historyFor,
      queryKey: getListEmployeeRateHistoryQueryKey(historyFor?.id ?? ''),
    },
  });

  const updateMutation = useUpdateEmployeeRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEmployeeRatesQueryKey() });
        setEditing(null);
        toast({
          title: 'Rate updated',
          description: 'The new pay rate was saved. Earlier entries keep the old rate.',
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

  const invalidateEmployees = () => {
    queryClient.invalidateQueries({ queryKey: getListEmployeeRatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
  };

  const createMutation = useCreateEmployee({
    mutation: {
      onSuccess: (employee) => {
        invalidateEmployees();
        setAddOpen(false);
        toast({
          title: 'Employee added',
          description: `${employee.name} was added with their starting pay rates.`,
        });
      },
      onError: () => {
        toast({
          title: 'Could not add employee',
          description: 'Please check the details and try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const removeMutation = useRemoveEmployee({
    mutation: {
      onSuccess: (employee) => {
        invalidateEmployees();
        setRemoving(null);
        toast({
          title: 'Employee removed',
          description: `${employee.name} was removed. Past time entries are kept.`,
        });
      },
      onError: () => {
        toast({
          title: 'Could not remove employee',
          description: 'Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const openAdd = () => {
    setNewName('');
    setNewRole('');
    setNewRates({
      hourlyRate: '',
      visitRate: '',
      mileageRate: '0.655',
      perDiemRate: '45',
      weekendMultiplier: '1.5',
      holidayMultiplier: '2',
    });
    setAddOpen(true);
  };

  const handleAdd = () => {
    if (!newName.trim()) {
      toast({ title: 'Missing name', description: 'Enter the employee name.', variant: 'destructive' });
      return;
    }
    if (!newRole.trim()) {
      toast({ title: 'Missing role', description: 'Enter the role (e.g. RN, PT).', variant: 'destructive' });
      return;
    }
    const values: Record<string, number> = {};
    for (const field of numericFields) {
      const parsed = Number(newRates[field.key]);
      if (newRates[field.key] === '' || !Number.isFinite(parsed) || parsed < field.min) {
        toast({
          title: 'Invalid value',
          description: `Enter a valid number for ${field.label} (minimum ${field.min}).`,
          variant: 'destructive',
        });
        return;
      }
      values[field.key] = parsed;
    }
    createMutation.mutate({
      data: {
        name: newName.trim(),
        role: newRole.trim(),
        hourlyRate: values.hourlyRate,
        visitRate: values.visitRate,
        mileageRate: values.mileageRate,
        perDiemRate: values.perDiemRate,
        weekendMultiplier: values.weekendMultiplier,
        holidayMultiplier: values.holidayMultiplier,
      },
    });
  };

  const openEdit = (rate: EmployeeRate) => {
    setEditing(rate);
    setForm({
      hourlyRate: rate.hourlyRate.toString(),
      visitRate: rate.visitRate.toString(),
      mileageRate: rate.mileageRate.toString(),
      perDiemRate: rate.perDiemRate.toString(),
      weekendMultiplier: rate.weekendMultiplier.toString(),
      holidayMultiplier: rate.holidayMultiplier.toString(),
      effectiveDate: new Date().toISOString().slice(0, 10),
    });
  };

  const handleSave = () => {
    if (!editing) return;
    const values: Record<string, number> = {};
    for (const field of numericFields) {
      const parsed = Number(form[field.key]);
      if (!Number.isFinite(parsed) || parsed < field.min) {
        toast({
          title: 'Invalid value',
          description: `Enter a valid number for ${field.label} (minimum ${field.min}).`,
          variant: 'destructive',
        });
        return;
      }
      values[field.key] = parsed;
    }
    if (!form.effectiveDate) {
      toast({
        title: 'Missing date',
        description: 'Choose an effective date.',
        variant: 'destructive',
      });
      return;
    }
    updateMutation.mutate({
      id: editing.id,
      data: {
        hourlyRate: values.hourlyRate,
        visitRate: values.visitRate,
        mileageRate: values.mileageRate,
        perDiemRate: values.perDiemRate,
        weekendMultiplier: values.weekendMultiplier,
        holidayMultiplier: values.holidayMultiplier,
        effectiveDate: form.effectiveDate,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Employee Pay Rates</CardTitle>
          <CardDescription>
            Current pay rates for all active employees
          </CardDescription>
        </div>
        <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-employee">
          <Plus className="h-4 w-4" />
          Add Employee
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
            <p>Couldn't load employee rates.</p>
            <p className="text-sm mt-1">Please try refreshing the page.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Hourly</TableHead>
                  <TableHead className="text-right">Visit</TableHead>
                  <TableHead className="text-right">Mileage</TableHead>
                  <TableHead className="text-right">Per Diem</TableHead>
                  <TableHead className="text-right">Weekend</TableHead>
                  <TableHead className="text-right">Holiday</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rates ?? []).map(rate => (
                  <TableRow key={rate.id} data-testid={`employee-rate-${rate.id}`}>
                    <TableCell className="font-medium">
                      <div>{rate.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{rate.employeeRole}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${rate.hourlyRate.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${rate.visitRate.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${rate.mileageRate.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${rate.perDiemRate.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {rate.weekendMultiplier}x
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {rate.holidayMultiplier}x
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
                          data-testid={`button-history-employee-rate-${rate.id}`}
                        >
                          <History className="h-3.5 w-3.5" />
                          History
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-2"
                          onClick={() => openEdit(rate)}
                          data-testid={`button-edit-employee-rate-${rate.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-2 text-destructive hover:text-destructive"
                          onClick={() => setRemoving({ employeeId: rate.employeeId, employeeName: rate.employeeName })}
                          data-testid={`button-remove-employee-${rate.employeeId}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employee</DialogTitle>
            <DialogDescription>
              The employee is added with these starting pay rates, effective today.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-employee-name">Name</Label>
              <Input
                id="new-employee-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Jane Doe"
                data-testid="input-new-employee-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-employee-role">Role</Label>
              <Input
                id="new-employee-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="e.g. RN, PT, OT"
                data-testid="input-new-employee-role"
              />
            </div>
            {numericFields.map(field => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`new-employee-${field.key}`}>{field.label}</Label>
                <Input
                  id={`new-employee-${field.key}`}
                  type="number"
                  min={field.min}
                  step={field.step}
                  value={newRates[field.key] ?? ''}
                  onChange={(e) => setNewRates(prev => ({ ...prev, [field.key]: e.target.value }))}
                  data-testid={`input-new-employee-${field.key}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add-employee">
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              className="gap-2"
              data-testid="button-save-add-employee"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Employee</DialogTitle>
            <DialogDescription>
              {removing
                ? `Remove ${removing.employeeName}? They will disappear from rate lists and can no longer log hours. All past time entries and rate history are kept.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} data-testid="button-cancel-remove-employee">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removing && removeMutation.mutate({ id: removing.employeeId })}
              disabled={removeMutation.isPending}
              className="gap-2"
              data-testid="button-confirm-remove-employee"
            >
              {removeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Pay Rate</DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.employeeName} (${editing.employeeRole}). The new rates apply from the effective date; earlier entries keep the old rates.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {numericFields.map(field => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`employee-${field.key}`}>{field.label}</Label>
                <Input
                  id={`employee-${field.key}`}
                  type="number"
                  min={field.min}
                  step={field.step}
                  value={form[field.key]}
                  onChange={(e) => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  data-testid={`input-employee-${field.key}`}
                />
              </div>
            ))}
            <div className="space-y-2 col-span-2">
              <Label htmlFor="employee-effective-date">Effective Date</Label>
              <Input
                id="employee-effective-date"
                type="date"
                value={form.effectiveDate}
                onChange={(e) => setForm(prev => ({ ...prev, effectiveDate: e.target.value }))}
                data-testid="input-employee-effective-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="button-cancel-employee-rate">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="gap-2"
              data-testid="button-save-employee-rate"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyFor} onOpenChange={(open) => !open && setHistoryFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pay Rate History</DialogTitle>
            <DialogDescription>
              {historyFor ? `${historyFor.employeeName} (${historyFor.employeeRole})` : ''}
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right">Hourly</TableHead>
                    <TableHead className="text-right">Visit</TableHead>
                    <TableHead className="text-right">Mileage</TableHead>
                    <TableHead className="text-right">Per Diem</TableHead>
                    <TableHead className="text-right">Weekend</TableHead>
                    <TableHead className="text-right">Holiday</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(historyQuery.data ?? []).map((row, index) => (
                    <TableRow key={row.id} data-testid={`employee-rate-history-${row.id}`}>
                      <TableCell className="font-mono text-sm">
                        {row.effectiveDate}
                        {index === 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">${row.hourlyRate.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">${row.visitRate.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">${row.mileageRate.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-mono">${row.perDiemRate.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{row.weekendMultiplier}x</TableCell>
                      <TableCell className="text-right font-mono">{row.holidayMultiplier}x</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
