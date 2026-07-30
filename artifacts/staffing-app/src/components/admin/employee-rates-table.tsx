import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployeeRates,
  useUpdateEmployeeRate,
  getListEmployeeRatesQueryKey,
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
import { Pencil, Loader2, AlertCircle } from 'lucide-react';
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

  const updateMutation = useUpdateEmployeeRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEmployeeRatesQueryKey() });
        setEditing(null);
        toast({ title: 'Rate updated', description: 'The employee pay rate has been saved.' });
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

  const openEdit = (rate: EmployeeRate) => {
    setEditing(rate);
    setForm({
      hourlyRate: rate.hourlyRate.toString(),
      visitRate: rate.visitRate.toString(),
      mileageRate: rate.mileageRate.toString(),
      perDiemRate: rate.perDiemRate.toString(),
      weekendMultiplier: rate.weekendMultiplier.toString(),
      holidayMultiplier: rate.holidayMultiplier.toString(),
      effectiveDate: rate.effectiveDate,
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
      <CardHeader>
        <CardTitle>Employee Pay Rates</CardTitle>
        <CardDescription>
          Current pay rates for all active employees
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Pay Rate</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.employeeName} (${editing.employeeRole})` : ''}
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
    </Card>
  );
}
