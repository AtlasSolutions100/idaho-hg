import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployeeRates,
  useUpdateEmployeeRate,
  useListEmployeeRateHistory,
  useCreateEmployee,
  useRemoveEmployee,
  useListEmployees,
  useUpdateEmployeeEmail,
  useUpdateEmployeeContact,
  useUpdateEmployeeDiscipline,
  useUpdateEmployeeSignInAccess,
  useListDisciplines,
  getListEmployeeRatesQueryKey,
  getListEmployeeRateHistoryQueryKey,
  getListEmployeesQueryKey,
  type EmployeeRate,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { isDemoId } from '@/lib/demo';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pencil, Loader2, AlertCircle, History, Plus, Trash2, Mail, Phone, MapPin, ContactRound } from 'lucide-react';
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
  // The discipline shown in the per-employee dialog (see handleSaveContact).
  const [contactDiscipline, setContactDiscipline] = useState('');
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
  const [newEmail, setNewEmail] = useState('');
  const [newRates, setNewRates] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ employeeId: string; employeeName: string } | null>(null);
  const [emailFor, setEmailFor] = useState<{ employeeId: string; employeeName: string } | null>(null);
  const [emailValue, setEmailValue] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [contactFor, setContactFor] = useState<{ employeeId: string; employeeName: string } | null>(null);
  const [contactForm, setContactForm] = useState({ phone: '', contactEmail: '', address: '' });
  const [contactError, setContactError] = useState<string | null>(null);

  // Roster (with sign-in emails + login status) so each row can show whether
  // the employee can sign in to the mobile app.
  const { data: employees } = useListEmployees();
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const emailByEmployeeId = new Map(
    (employees ?? []).map((e) => [e.id, e.email ?? '']),
  );

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
      onError: (error) => {
        const serverMessage =
          error && typeof error === 'object' && 'data' in error &&
          error.data && typeof error.data === 'object' && 'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : null;
        setAddError(serverMessage ?? 'Could not add the employee. Please check the details and try again.');
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

  const emailMutation = useUpdateEmployeeEmail({
    mutation: {
      onSuccess: (employee) => {
        invalidateEmployees();
        setEmailFor(null);
        toast({
          title: 'Sign-in email saved',
          description: employee.email
            ? `${employee.name} can now sign in to the mobile app with ${employee.email}.`
            : `${employee.name}'s sign-in email was removed.`,
        });
      },
      onError: (error) => {
        const serverMessage =
          error && typeof error === 'object' && 'data' in error &&
          error.data && typeof error.data === 'object' && 'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : null;
        setEmailError(serverMessage ?? 'Could not save the email. Please try again.');
      },
    },
  });

  const signInAccessMutation = useUpdateEmployeeSignInAccess({
    mutation: {
      onSuccess: (employee) => {
        invalidateEmployees();
        toast({
          title: employee.signInEnabled ? 'Sign-in turned on' : 'Sign-in turned off',
          description: employee.signInEnabled
            ? `${employee.name} can sign in to the mobile app again.`
            : `${employee.name} can no longer sign in to the mobile app. Their info and past entries are kept.`,
        });
      },
      onError: () => {
        toast({
          title: 'Could not update sign-in access',
          description: 'Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const contactMutation = useUpdateEmployeeContact({
    mutation: {
      onSuccess: (employee) => {
        invalidateEmployees();
        setContactFor(null);
        toast({
          title: 'Contact info saved',
          description: `${employee.name}'s contact details were updated.`,
        });
      },
      onError: (error) => {
        const serverMessage =
          error && typeof error === 'object' && 'data' in error &&
          error.data && typeof error.data === 'object' && 'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : null;
        setContactError(serverMessage ?? 'Could not save the contact details. Please try again.');
      },
    },
  });

  const { data: disciplines } = useListDisciplines();
  // Retired disciplines stay selectable for someone already on one, so opening
  // the dialog can't silently reassign them.
  const disciplineOptions = (disciplines ?? []).filter(
    (d) => d.active || d.key === contactDiscipline,
  );

  const disciplineMutation = useUpdateEmployeeDiscipline({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListEmployeeRatesQueryKey() });
      },
      onError: (error) => {
        const serverMessage =
          error && typeof error === 'object' && 'data' in error &&
          error.data && typeof error.data === 'object' && 'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : null;
        setContactError(serverMessage ?? 'Could not change the discipline. Please try again.');
      },
    },
  });

  const openContact = (employeeId: string, employeeName: string) => {
    const emp = employeeById.get(employeeId);
    setContactFor({ employeeId, employeeName });
    setContactForm({
      phone: emp?.phone ?? '',
      contactEmail: emp?.contactEmail ?? '',
      address: emp?.address ?? '',
    });
    setContactDiscipline(emp?.role ?? '');
    setContactError(null);
  };

  const handleSaveContact = async () => {
    if (!contactFor) return;
    setContactError(null);
    const currentRole = employeeById.get(contactFor.employeeId)?.role ?? '';
    // The discipline is a separate endpoint because it does more than store a
    // string: it re-stamps the employee's not-yet-approved entries so they
    // price under the corrected discipline. Save it first — if it fails, the
    // dialog stays open with the error and nothing is half-applied.
    if (contactDiscipline && contactDiscipline !== currentRole) {
      try {
        const result = await disciplineMutation.mutateAsync({
          id: contactFor.employeeId,
          data: { discipline: contactDiscipline },
        });
        if (result.restampedEntryCount > 0) {
          toast({
            title: 'Discipline changed',
            description: `${result.restampedEntryCount} entr${
              result.restampedEntryCount === 1 ? 'y' : 'ies'
            } still waiting for approval will now be priced as ${contactDiscipline}. Approved entries keep the discipline they were paid under.`,
          });
        }
      } catch {
        return; // onError already set the message
      }
    }
    contactMutation.mutate({
      id: contactFor.employeeId,
      data: {
        phone: contactForm.phone,
        contactEmail: contactForm.contactEmail,
        address: contactForm.address,
      },
    });
  };

  const openEmail = (employeeId: string, employeeName: string) => {
    setEmailFor({ employeeId, employeeName });
    setEmailValue(emailByEmployeeId.get(employeeId) ?? '');
    setEmailError(null);
  };

  const handleSaveEmail = () => {
    if (!emailFor) return;
    setEmailError(null);
    emailMutation.mutate({ id: emailFor.employeeId, data: { email: emailValue.trim() } });
  };

  const openAdd = () => {
    setNewName('');
    setNewRole('');
    setNewEmail('');
    setNewPhone('');
    setNewContactEmail('');
    setNewAddress('');
    setNewRates({
      hourlyRate: '',
      visitRate: '',
      mileageRate: '0.65',
      perDiemRate: '45',
      weekendMultiplier: '1.5',
      holidayMultiplier: '2',
    });
    setAddError(null);
    setAddOpen(true);
  };

  const handleAdd = () => {
    setAddError(null);
    if (!newName.trim()) {
      toast({ title: 'Missing name', description: 'Enter the employee name.', variant: 'destructive' });
      return;
    }
    if (!newRole.trim()) {
      toast({
        title: 'Missing discipline',
        description: "Pick the employee's discipline — it decides their rates.",
        variant: 'destructive',
      });
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
        ...(newEmail.trim() ? { email: newEmail.trim() } : {}),
        ...(newPhone.trim() ? { phone: newPhone.trim() } : {}),
        ...(newContactEmail.trim() ? { contactEmail: newContactEmail.trim() } : {}),
        ...(newAddress.trim() ? { address: newAddress.trim() } : {}),
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
          <CardTitle>Employees</CardTitle>
          <CardDescription>
            Contact info, app sign-in, and pay rates for everyone on your team
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
                  <TableHead>Contact</TableHead>
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
                      <div className="flex items-center gap-2">
                        {rate.employeeName}
                        {isDemoId(rate.employeeId) && (
                          <Badge variant="outline" className="text-xs font-normal">Demo</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{rate.employeeRole}</div>
                      <button
                        type="button"
                        onClick={() => openEmail(rate.employeeId, rate.employeeName)}
                        className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                        data-testid={`button-email-employee-${rate.employeeId}`}
                      >
                        <Mail className="h-3 w-3" />
                        {emailByEmployeeId.get(rate.employeeId) || 'Add sign-in email'}
                      </button>
                      {(() => {
                        const emp = employeeById.get(rate.employeeId);
                        if (!emp?.email) {
                          return (
                            <Badge
                              variant="outline"
                              className="mt-1 text-xs font-normal text-muted-foreground"
                              data-testid={`badge-signin-status-${rate.employeeId}`}
                            >
                              No sign-in email
                            </Badge>
                          );
                        }
                        return emp.signInEnabled ? (
                          <Badge
                            variant="outline"
                            className="mt-1 border-primary/40 text-xs font-normal text-primary"
                            data-testid={`badge-signin-status-${rate.employeeId}`}
                          >
                            Can sign in
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="mt-1 border-destructive/40 text-xs font-normal text-destructive"
                            data-testid={`badge-signin-status-${rate.employeeId}`}
                          >
                            Sign-in disabled
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const emp = employeeById.get(rate.employeeId);
                        const hasContact = !!(emp?.phone || emp?.contactEmail || emp?.address);
                        return (
                          <div className="space-y-0.5 text-xs text-muted-foreground" data-testid={`contact-info-${rate.employeeId}`}>
                            {emp?.phone && (
                              <div className="flex items-center gap-1">
                                <Phone className="h-3 w-3 shrink-0" />
                                {emp.phone}
                              </div>
                            )}
                            {emp?.contactEmail && (
                              <div className="flex items-center gap-1">
                                <Mail className="h-3 w-3 shrink-0" />
                                {emp.contactEmail}
                              </div>
                            )}
                            {emp?.address && (
                              <div className="flex items-start gap-1">
                                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                <span className="whitespace-pre-line">{emp.address}</span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => openContact(rate.employeeId, rate.employeeName)}
                              className="flex items-center gap-1 underline-offset-2 hover:underline"
                              data-testid={`button-contact-employee-${rate.employeeId}`}
                            >
                              <ContactRound className="h-3 w-3" />
                              {hasContact ? 'Edit contact info' : 'Add contact info'}
                            </button>
                          </div>
                        );
                      })()}
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
              <Label htmlFor="new-employee-role">Discipline</Label>
              {/* Picked, not typed: this value is the key that resolves their
                  pay and billing rates, so a typo would pay them nothing. */}
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="new-employee-role" data-testid="input-new-employee-role">
                  <SelectValue placeholder="Pick a discipline" />
                </SelectTrigger>
                <SelectContent>
                  {(disciplines ?? [])
                    .filter((d) => d.active)
                    .map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        {d.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="new-employee-email">Sign-in email (optional)</Label>
              <Input
                id="new-employee-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="e.g. jane@example.com"
                data-testid="input-new-employee-email"
              />
              <p className="text-xs text-muted-foreground">
                Lets the employee sign in to the mobile app with a code sent to this email.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-employee-phone">Phone (optional)</Label>
              <Input
                id="new-employee-phone"
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="e.g. (208) 555-0142"
                data-testid="input-new-employee-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-employee-contact-email">Contact email (optional)</Label>
              <Input
                id="new-employee-contact-email"
                type="email"
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                placeholder="e.g. jane@gmail.com"
                data-testid="input-new-employee-contact-email"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="new-employee-address">Address (optional)</Label>
              <Input
                id="new-employee-address"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="e.g. 123 Main St, Boise, ID 83702"
                data-testid="input-new-employee-address"
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
            {addError && (
              <div
                className="col-span-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-add-employee"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{addError}</span>
              </div>
            )}
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

      <Dialog open={!!contactFor} onOpenChange={(open) => !open && setContactFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Employee Details</DialogTitle>
            <DialogDescription>
              {contactFor
                ? `${contactFor.employeeName}'s discipline and how you reach them — separate from their app sign-in email. Leave a contact field blank to clear it.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contact-discipline">Discipline</Label>
              <Select value={contactDiscipline} onValueChange={setContactDiscipline}>
                <SelectTrigger id="contact-discipline" data-testid="select-employee-discipline">
                  <SelectValue placeholder="Pick a discipline" />
                </SelectTrigger>
                <SelectContent>
                  {disciplineOptions.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Decides which visit types they see and which rates they're paid
                and billed at. Entries you've already approved keep the
                discipline they were paid under.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={contactForm.phone}
                onChange={(e) => setContactForm((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="e.g. (208) 555-0142"
                data-testid="input-contact-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Contact email</Label>
              <Input
                id="contact-email"
                type="email"
                value={contactForm.contactEmail}
                onChange={(e) => setContactForm((prev) => ({ ...prev, contactEmail: e.target.value }))}
                placeholder="e.g. jane@gmail.com"
                data-testid="input-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-address">Address</Label>
              <Input
                id="contact-address"
                value={contactForm.address}
                onChange={(e) => setContactForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="e.g. 123 Main St, Boise, ID 83702"
                data-testid="input-contact-address"
              />
            </div>
            {contactError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-contact-info"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{contactError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactFor(null)} data-testid="button-cancel-contact-info">
              Cancel
            </Button>
            <Button
              onClick={handleSaveContact}
              disabled={contactMutation.isPending || disciplineMutation.isPending}
              className="gap-2"
              data-testid="button-save-contact-info"
            >
              {contactMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailFor} onOpenChange={(open) => !open && setEmailFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign-in Email</DialogTitle>
            <DialogDescription>
              {emailFor?.employeeName} will sign in to the mobile app with a one-time
              code sent to this email. Leave it blank to remove app access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="employee-email">Email</Label>
            <Input
              id="employee-email"
              type="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              placeholder="e.g. jane@example.com"
              data-testid="input-employee-email"
            />
            {emailError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-employee-email"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{emailError}</span>
              </div>
            )}
            {emailFor && employeeById.get(emailFor.employeeId)?.email && (
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="text-sm">
                  {employeeById.get(emailFor.employeeId)?.signInEnabled ? (
                    <>
                      <p className="font-medium">Sign-in is on</p>
                      <p className="text-xs text-muted-foreground">
                        Turn it off to block app access without removing them. You can
                        turn it back on anytime.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-destructive">Sign-in is off</p>
                      <p className="text-xs text-muted-foreground">
                        They can't use the mobile app right now. Turn it back on to
                        restore access.
                      </p>
                    </>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={
                    employeeById.get(emailFor.employeeId)?.signInEnabled
                      ? 'outline'
                      : 'default'
                  }
                  className="shrink-0 gap-2"
                  disabled={signInAccessMutation.isPending}
                  onClick={() =>
                    signInAccessMutation.mutate({
                      id: emailFor.employeeId,
                      data: {
                        signInEnabled: !employeeById.get(emailFor.employeeId)?.signInEnabled,
                      },
                    })
                  }
                  data-testid="button-toggle-signin-access"
                >
                  {signInAccessMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {employeeById.get(emailFor.employeeId)?.signInEnabled
                    ? 'Turn off sign-in'
                    : 'Turn on sign-in'}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailFor(null)} data-testid="button-cancel-employee-email">
              Cancel
            </Button>
            <Button
              onClick={handleSaveEmail}
              disabled={emailMutation.isPending}
              className="gap-2"
              data-testid="button-save-employee-email"
            >
              {emailMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
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
