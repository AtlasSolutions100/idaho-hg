import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListDisciplines,
  useCreateDiscipline,
  useUpdateDiscipline,
  getListDisciplinesQueryKey,
  type DisciplineItem,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { Pencil, Loader2, AlertCircle, Plus, BadgeCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/** "Registered Nurse" -> "REGISTERED-NURSE" — the same shape the server uses. */
function normalizeKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serverErrorMessage(error: unknown): string | null {
  return error && typeof error === 'object' && 'data' in error &&
    error.data && typeof error.data === 'object' && 'message' in error.data &&
    typeof (error.data as { message?: unknown }).message === 'string'
    ? (error.data as { message: string }).message
    : null;
}

/**
 * The list of professions on the team. It matters more than a label: the key
 * is what resolves an employee's pay rate (the discipline x visit-type matrix)
 * and their billing rate ("hourly-RN"), so it is picked from here rather than
 * typed on the employee — a typo would quietly resolve no rate at all.
 *
 * The key can't be edited after creation for the same reason: it is already
 * stamped on employees, on their submitted entries, and on every rate row that
 * references it.
 */
export function DisciplinesTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: disciplines, isLoading, isError } = useListDisciplines();

  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const [editing, setEditing] = useState<DisciplineItem | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editSortOrder, setEditSortOrder] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDisciplinesQueryKey() });

  const createMutation = useCreateDiscipline({
    mutation: {
      onSuccess: (created) => {
        invalidate();
        setAddOpen(false);
        toast({
          title: 'Discipline added',
          description: `"${created.label}" can now be assigned to employees. Set their rates on the Visit Pay Rates page.`,
        });
      },
      onError: (error) => {
        setAddError(serverErrorMessage(error) ?? 'Could not add the discipline. Please try again.');
      },
    },
  });

  const updateMutation = useUpdateDiscipline({
    mutation: {
      onSuccess: (updated) => {
        invalidate();
        setEditing(null);
        toast({
          title: 'Discipline updated',
          description: updated.active
            ? `"${updated.label}" was saved.`
            : `"${updated.label}" was retired — employees already on it keep it, but it's hidden from the pickers.`,
        });
      },
      onError: (error) => {
        setEditError(serverErrorMessage(error) ?? 'Could not save the changes. Please try again.');
      },
    },
  });

  const openAdd = () => {
    setNewLabel('');
    setNewKey('');
    setAddError(null);
    setAddOpen(true);
  };

  const previewKey = newKey.trim() ? normalizeKey(newKey) : normalizeKey(newLabel);

  const handleAdd = () => {
    setAddError(null);
    const label = newLabel.trim();
    if (!label) {
      setAddError('Enter a name.');
      return;
    }
    const key = previewKey;
    if (!key) {
      setAddError('Enter a name (or short code) that contains letters or numbers.');
      return;
    }
    createMutation.mutate({ data: { key, label } });
  };

  const openEdit = (item: DisciplineItem) => {
    setEditing(item);
    setEditLabel(item.label);
    setEditSortOrder(String(item.sortOrder));
    setEditActive(item.active);
    setEditError(null);
  };

  const handleSaveEdit = () => {
    if (!editing) return;
    setEditError(null);
    const label = editLabel.trim();
    if (!label) {
      setEditError('Enter a name.');
      return;
    }
    const sortOrder = Number(editSortOrder);
    if (
      editSortOrder.trim() === '' ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0
    ) {
      setEditError('Enter a whole number (0 or more) for sort order.');
      return;
    }
    updateMutation.mutate({
      key: editing.key,
      data: { label, sortOrder, active: editActive },
    });
  };

  const sorted = [...(disciplines ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Disciplines</CardTitle>
          <CardDescription>
            The professions on your team. Each employee has one, and it decides
            which visit types they see and which rates they're paid and billed at.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-discipline">
          <Plus className="h-4 w-4" />
          Add discipline
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
            <p>Couldn't load disciplines.</p>
            <p className="text-sm mt-1">Please try refreshing the page.</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <BadgeCheck className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No disciplines yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sort Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((item) => (
                  <TableRow
                    key={item.key}
                    data-testid={`discipline-${item.key}`}
                    className={item.active ? undefined : 'opacity-60'}
                  >
                    <TableCell className="font-mono font-medium">{item.key}</TableCell>
                    <TableCell>{item.label}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={item.active ? undefined : 'text-muted-foreground'}
                        data-testid={`status-discipline-${item.key}`}
                      >
                        {item.active ? 'Active' : 'Retired'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {item.sortOrder}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-2"
                        onClick={() => openEdit(item)}
                        data-testid={`button-edit-discipline-${item.key}`}
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

      {/* Add discipline */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add discipline</DialogTitle>
            <DialogDescription>
              A new discipline has no rates yet — set them on the Visit Pay Rates
              and Client Rates pages, or employees on it will show as "no rate".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-discipline-label">Name</Label>
              <Input
                id="new-discipline-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. COTA — Certified OT Assistant"
                data-testid="input-new-discipline-label"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-discipline-key">
                Short code <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="new-discipline-key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Auto-generated from the name"
                data-testid="input-new-discipline-key"
              />
              <p className="text-xs text-muted-foreground">
                Used on employees and in rate lookups. Leave blank to use{' '}
                <span className="font-mono">{previewKey || '—'}</span>. Can't be
                changed later.
              </p>
            </div>
            {addError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-add-discipline"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{addError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              data-testid="button-cancel-add-discipline"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              className="gap-2"
              data-testid="button-save-add-discipline"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add discipline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit discipline */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit discipline</DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.label} — code "${editing.key}" can't change; it's already on employees, their entries, and their rate rows.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-discipline-label">Name</Label>
              <Input
                id="edit-discipline-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                data-testid="input-edit-discipline-label"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-discipline-sort-order">Sort Order</Label>
              <Input
                id="edit-discipline-sort-order"
                type="number"
                min="0"
                step="1"
                value={editSortOrder}
                onChange={(e) => setEditSortOrder(e.target.value)}
                data-testid="input-edit-discipline-sort-order"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first in the pickers.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="edit-discipline-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  When off, this discipline is retired — hidden from the pickers,
                  but employees already on it keep it and their rates still resolve.
                </p>
              </div>
              <Switch
                id="edit-discipline-active"
                checked={editActive}
                onCheckedChange={setEditActive}
                data-testid="switch-edit-discipline-active"
              />
            </div>
            {editError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-edit-discipline"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{editError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              data-testid="button-cancel-edit-discipline"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              className="gap-2"
              data-testid="button-save-edit-discipline"
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
