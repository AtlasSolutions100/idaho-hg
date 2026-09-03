import { useState } from 'react';
import { useClerk } from '@clerk/react';
import {
  useGetMyEmployee,
  useListTimeEntries,
  getGetMyEmployeeQueryKey,
  getListTimeEntriesQueryKey,
  type TimeEntry,
  type Employee,
} from '@workspace/api-client-react';
import { ApiError } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { LogHoursForm } from '@/components/employee/log-hours-form';
import { TimeEntriesList } from '@/components/employee/time-entries-list';
import { Plus, Clock, CheckCircle, LogOut, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ThemeToggle } from '@/components/theme-toggle';
import { useLocation } from 'wouter';

/**
 * What to tell someone who is signed in but whose email isn't (yet) an
 * employee we can log hours for. The server sends a stable `code` with each
 * of these so the wording here can change without breaking the branch.
 */
function accessMessage(error: unknown): { title: string; body: string } {
  const code =
    error instanceof ApiError && error.data && typeof error.data === 'object'
      ? (error.data as { code?: string }).code
      : undefined;
  switch (code) {
    case 'LINK_REQUEST_PENDING':
      return {
        title: 'Waiting on Molly',
        body: "You've asked to be linked to a profile. Molly still needs to confirm it's you — check back in a bit.",
      };
    case 'SIGN_IN_DISABLED':
      return {
        title: 'Sign-in turned off',
        body: 'Your sign-in has been turned off. Ask Molly if you think this is a mistake.',
      };
    case 'NOT_LINKED':
      return {
        title: "You're not set up yet",
        body: "This email isn't linked to a team profile. Ask Molly to add it to your profile, then sign in again.",
      };
    default:
      return {
        title: "Couldn't load your profile",
        body: 'Something went wrong on our side. Try again in a moment — if it keeps happening, send feedback.',
      };
  }
}

/** Shared chrome so the loading and no-access states aren't bare text. */
function DashboardShell({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Log Hours</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-10">{children}</div>
    </div>
  );
}

export default function EmployeeDashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { toast } = useToast();
  // The page is behind a sign-in gate, so there is always a session here —
  // but a session isn't automatically a roster profile. Everything below
  // hangs off the profile the server resolves from the signed-in email; there
  // is deliberately no fallback employee id, because guessing one would have
  // shown someone else's hours.
  const {
    data: me,
    isPending,
    error,
  } = useGetMyEmployee({
    query: { retry: false, queryKey: getGetMyEmployeeQueryKey() },
  });

  const handleSignOut = () => {
    void signOut(() => setLocation('/'));
  };

  if (isPending) {
    return (
      <DashboardShell subtitle="Loading…">
        <div
          className="flex items-center justify-center gap-2 py-16 text-muted-foreground"
          data-testid="text-loading-profile"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading your profile…
        </div>
      </DashboardShell>
    );
  }

  if (error || !me) {
    const { title, body } = accessMessage(error);
    return (
      <DashboardShell subtitle="Not signed in to a profile">
        <div className="rounded-xl border bg-card px-6 py-8 text-center space-y-3">
          <h2 className="text-lg font-medium" data-testid="text-no-access-title">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="text-no-access-body">
            {body}
          </p>
          <Button
            variant="outline"
            onClick={handleSignOut}
            className="gap-2 mt-2"
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </DashboardShell>
    );
  }

  return <SignedInDashboard
    me={me}
    showForm={showForm}
    setShowForm={setShowForm}
    editingEntry={editingEntry}
    setEditingEntry={setEditingEntry}
    onSignOut={handleSignOut}
    onToast={toast}
  />;
}

function SignedInDashboard({
  me,
  showForm,
  setShowForm,
  editingEntry,
  setEditingEntry,
  onSignOut,
  onToast,
}: {
  me: Employee;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editingEntry: TimeEntry | null;
  setEditingEntry: (e: TimeEntry | null) => void;
  onSignOut: () => void;
  onToast: ReturnType<typeof useToast>['toast'];
}) {
  const employeeId = me.id;
  const { data: entries } = useListTimeEntries(
    { employeeId },
    { query: { queryKey: getListTimeEntriesQueryKey({ employeeId }) } },
  );
  const submittedCount = (entries ?? []).filter(e => e.status === 'submitted').length;
  const draftCount = (entries ?? []).filter(e => e.status === 'draft').length;

  const handleSubmit = (savedAsDraft: boolean) => {
    setShowForm(false);
    setEditingEntry(null);
    onToast({
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
              <p className="text-sm text-muted-foreground" data-testid="text-employee-name">
                {me.name}
              </p>
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
                onClick={onSignOut}
                className="gap-1.5 text-muted-foreground"
                aria-label="Sign out"
                data-testid="button-exit"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
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
            discipline={me.role}
            entry={editingEntry ?? undefined}
            allowDraft
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
              <TimeEntriesList employeeId={employeeId} onEdit={setEditingEntry} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
