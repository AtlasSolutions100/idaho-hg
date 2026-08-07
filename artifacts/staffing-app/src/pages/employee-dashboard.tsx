import { useState } from 'react';
import {
  useGetMyEmployee,
  useListTimeEntries,
  getGetMyEmployeeQueryKey,
  getListTimeEntriesQueryKey,
  type TimeEntry,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { LogHoursForm } from '@/components/employee/log-hours-form';
import { TimeEntriesList } from '@/components/employee/time-entries-list';
import { Plus, Clock, CheckCircle, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ThemeToggle } from '@/components/theme-toggle';
import { useLocation } from 'wouter';

export default function EmployeeDashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Drafts and editing require a signed-in, roster-linked employee — the
  // server only shows drafts to (and accepts edits from) their author.
  // Without a session this page still works for logging and viewing hours.
  const { data: me } = useGetMyEmployee({
    query: { retry: false, queryKey: getGetMyEmployeeQueryKey() },
  });
  const employeeId = me?.id ?? '1';
  const { data: entries } = useListTimeEntries(
    { employeeId },
    { query: { queryKey: getListTimeEntriesQueryKey({ employeeId }) } },
  );
  const submittedCount = (entries ?? []).filter(e => e.status === 'submitted').length;
  const draftCount = (entries ?? []).filter(e => e.status === 'draft').length;
  const canDraftAndEdit = !!me;

  const handleSubmit = (savedAsDraft: boolean) => {
    setShowForm(false);
    setEditingEntry(null);
    toast({
      title: savedAsDraft ? 'Draft saved' : 'Hours submitted',
      description: savedAsDraft
        ? 'Your draft is saved — only you can see it until you submit it.'
        : 'Your time entry has been submitted for approval.',
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Log Hours</h1>
              <p className="text-sm text-muted-foreground">Sarah Martinez</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span className="font-mono font-medium">{submittedCount} submitted</span>
              </div>
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation('/')}
                className="gap-1.5 text-muted-foreground"
                aria-label="Exit to welcome screen"
                data-testid="button-exit"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Exit</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {showForm || editingEntry ? (
          <LogHoursForm
            employeeId={employeeId}
            entry={editingEntry ?? undefined}
            allowDraft={canDraftAndEdit}
            onSubmit={handleSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingEntry(null);
            }}
          />
        ) : (
          <>
            <Button
              onClick={() => setShowForm(true)}
              className="w-full gap-2 h-14 text-base"
              size="lg"
              data-testid="button-log-hours"
            >
              <Plus className="h-5 w-5" />
              Log Hours
            </Button>

            <div className="pt-2">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Your Hours</h2>
                {draftCount > 0 && (
                  <span className="text-sm text-muted-foreground" data-testid="text-draft-count">
                    · {draftCount} draft{draftCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <TimeEntriesList
                employeeId={employeeId}
                onEdit={canDraftAndEdit ? setEditingEntry : undefined}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
