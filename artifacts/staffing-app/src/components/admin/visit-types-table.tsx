import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListVisitTypes,
  useCreateVisitType,
  useUpdateVisitType,
  getListVisitTypesQueryKey,
  type VisitTypeItem,
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
import { Pencil, Loader2, AlertCircle, Plus, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/** Turn a label (or typed key) into a stable lowercase slug, e.g.
 *  "Wound Care Visit" -> "wound-care-visit". */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parsed `message` field from a generated-client ApiError, if present. */
function serverErrorMessage(error: unknown): string | null {
  return error && typeof error === 'object' && 'data' in error &&
    error.data && typeof error.data === 'object' && 'message' in error.data &&
    typeof (error.data as { message?: unknown }).message === 'string'
    ? (error.data as { message: string }).message
    : null;
}

/**
 * Admin catalog for visit types. Molly can add a new type in ~30 seconds
 * (no developer) and retire an old one. Adding a type makes it show up in the
 * employee log-hours picker, the admin fix form, and the client rate dropdowns
 * with no code change (all read the same catalog via useVisitTypes). Retiring a
 * type (Active off) keeps it on historical entries but hides it from pickers.
 */
export function VisitTypesTable() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: visitTypes, isLoading, isError } = useListVisitTypes();

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAbbreviation, setNewAbbreviation] = useState('');
  const [newKey, setNewKey] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Edit dialog
  const [editing, setEditing] = useState<VisitTypeItem | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAbbreviation, setEditAbbreviation] = useState('');
  const [editSortOrder, setEditSortOrder] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVisitTypesQueryKey() });

  const createMutation = useCreateVisitType({
    mutation: {
      onSuccess: (created) => {
        invalidate();
        setAddOpen(false);
        toast({
          title: 'Visit type added',
          description: `"${created.label}" is now available for employees to log.`,
        });
      },
      onError: (error) => {
        setAddError(serverErrorMessage(error) ?? 'Could not add the visit type. Please try again.');
      },
    },
  });

  const updateMutation = useUpdateVisitType({
    mutation: {
      onSuccess: (updated) => {
        invalidate();
        setEditing(null);
        toast({
          title: 'Visit type updated',
          description: updated.active
            ? `"${updated.label}" was saved.`
            : `"${updated.label}" was retired — it stays on past entries but is hidden from employee pickers.`,
        });
      },
      onError: (error) => {
        setEditError(serverErrorMessage(error) ?? 'Could not save the changes. Please try again.');
      },
    },
  });

  const openAdd = () => {
    setNewLabel('');
    setNewAbbreviation('');
    setNewKey('');
    setAddError(null);
    setAddOpen(true);
  };

  // Preview of the key that will be used, so Molly can see the auto-slug.
  const previewKey = newKey.trim() ? slugify(newKey) : slugify(newLabel);

  const handleAdd = () => {
    setAddError(null);
    const label = newLabel.trim();
    const abbreviation = newAbbreviation.trim();
    if (!label) {
      setAddError('Enter a label.');
      return;
    }
    if (!abbreviation) {
      setAddError('Enter an abbreviation.');
      return;
    }
    // Optional key: auto-slugified from the label when left blank.
    const key = newKey.trim() ? slugify(newKey) : slugify(label);
    if (!key) {
      setAddError('Enter a label (or key) that contains letters or numbers.');
      return;
    }
    createMutation.mutate({ data: { key, label, abbreviation } });
  };

  const openEdit = (item: VisitTypeItem) => {
    setEditing(item);
    setEditLabel(item.label);
    setEditAbbreviation(item.abbreviation);
    setEditSortOrder(String(item.sortOrder));
    setEditActive(item.active);
    setEditError(null);
  };

  const handleSaveEdit = () => {
    if (!editing) return;
    setEditError(null);
    const label = editLabel.trim();
    const abbreviation = editAbbreviation.trim();
    if (!label) {
      setEditError('Enter a label.');
      return;
    }
    if (!abbreviation) {
      setEditError('Enter an abbreviation.');
      return;
    }
    const sortOrder = Number(editSortOrder);
    if (
      editSortOrder.trim() === '' ||
      !Number.isFinite(sortOrder) ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0
    ) {
      setEditError('Enter a whole number (0 or more) for sort order.');
      return;
    }
    updateMutation.mutate({
      key: editing.key,
      data: { label, abbreviation, sortOrder, active: editActive },
    });
  };

  // Show every type (active and retired), in catalog order.
  const sorted = [...(visitTypes ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Visit Types</CardTitle>
          <CardDescription>
            The visit types employees can log. Retiring one keeps it on past entries but hides it
            from the log-hours picker.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-visit-type">
          <Plus className="h-4 w-4" />
          Add visit type
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
            <p>Couldn't load visit types.</p>
            <p className="text-sm mt-1">Please try refreshing the page.</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Tag className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No visit types yet.</p>
            <p className="text-sm mt-1">Add the first one so employees can log visits.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Abbreviation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sort Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((item) => (
                  <TableRow
                    key={item.key}
                    data-testid={`visit-type-${item.key}`}
                    className={item.active ? undefined : 'opacity-60'}
                  >
                    <TableCell className="font-medium">
                      {item.label}
                      <div className="text-xs text-muted-foreground font-mono">{item.key}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{item.abbreviation}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={item.active ? undefined : 'text-muted-foreground'}
                        data-testid={`status-visit-type-${item.key}`}
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
                        data-testid={`button-edit-visit-type-${item.key}`}
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

      {/* Add visit type */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add visit type</DialogTitle>
            <DialogDescription>
              New types show up right away in the employee log-hours picker and the rate dropdowns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-visit-type-label">Label</Label>
              <Input
                id="new-visit-type-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Wound Care Visit"
                data-testid="input-new-visit-type-label"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-visit-type-abbreviation">Abbreviation</Label>
              <Input
                id="new-visit-type-abbreviation"
                value={newAbbreviation}
                onChange={(e) => setNewAbbreviation(e.target.value)}
                placeholder="e.g. WCV"
                data-testid="input-new-visit-type-abbreviation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-visit-type-key">
                Key <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="new-visit-type-key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Auto-generated from the label"
                data-testid="input-new-visit-type-key"
              />
              <p className="text-xs text-muted-foreground">
                Stable identifier saved on entries. Leave blank to use{' '}
                <span className="font-mono">{previewKey || '—'}</span>. Can't be changed later.
              </p>
            </div>
            {addError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-add-visit-type"
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
              data-testid="button-cancel-add-visit-type"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              className="gap-2"
              data-testid="button-save-add-visit-type"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add visit type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit visit type */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit visit type</DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.label} — key "${editing.key}" can't change. Turning Active off retires it: past entries keep it, but employees no longer see it in the picker.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-visit-type-label">Label</Label>
              <Input
                id="edit-visit-type-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                data-testid="input-edit-visit-type-label"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-visit-type-abbreviation">Abbreviation</Label>
              <Input
                id="edit-visit-type-abbreviation"
                value={editAbbreviation}
                onChange={(e) => setEditAbbreviation(e.target.value)}
                data-testid="input-edit-visit-type-abbreviation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-visit-type-sort-order">Sort Order</Label>
              <Input
                id="edit-visit-type-sort-order"
                type="number"
                min="0"
                step="1"
                value={editSortOrder}
                onChange={(e) => setEditSortOrder(e.target.value)}
                data-testid="input-edit-visit-type-sort-order"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first in the employee picker.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="edit-visit-type-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  When off, this type is retired — hidden from employee pickers but kept on past
                  entries.
                </p>
              </div>
              <Switch
                id="edit-visit-type-active"
                checked={editActive}
                onCheckedChange={setEditActive}
                data-testid="switch-edit-visit-type-active"
              />
            </div>
            {editError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="error-edit-visit-type"
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
              data-testid="button-cancel-edit-visit-type"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              className="gap-2"
              data-testid="button-save-edit-visit-type"
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
