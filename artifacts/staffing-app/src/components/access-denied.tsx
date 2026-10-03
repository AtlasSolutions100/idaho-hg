import { useClerk } from '@clerk/react';
import { useLocation } from 'wouter';
import type { Session } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogOut, Clock, ShieldAlert, Wrench } from 'lucide-react';

/**
 * Why the administrator screens won't open, said plainly.
 *
 * This exists because of a real, weeks-long failure: Molly opened the admin
 * side, every request behind it was refused, and the app showed her empty
 * panels. She reported that the app "cannot find my account" and stopped
 * trying. There are two very different reasons this happens and the app used
 * to show the same nothing for both — so each gets its own wording, and each
 * says what to do next.
 */
export function AdminAccessDenied({ session }: { session: Session }) {
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  // No admin configured at all: nobody on earth can open these screens, so
  // telling the owner "you aren't the administrator" would be a lie and would
  // send her looking for a mistake she didn't make.
  const notConfigured = !session.adminConfigured;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="bg-card border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Administrator</h1>
            <p className="text-sm text-muted-foreground">
              {session.email ?? 'Signed in'}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="rounded-xl border bg-card px-6 py-8 space-y-4">
          <div className="flex items-start gap-3">
            {notConfigured ? (
              <Wrench className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            )}
            <div className="space-y-2 min-w-0">
              <h2 className="text-lg font-medium" data-testid="text-admin-denied-title">
                {notConfigured
                  ? 'The administrator account isn’t set up yet'
                  : 'These screens are for the administrator'}
              </h2>
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-admin-denied-body"
              >
                {notConfigured ? (
                  <>
                    No administrator has been configured for this app, so nobody
                    can open approvals, rates or reports yet. This is a setup
                    step on our side — send us a note and we’ll finish it.
                  </>
                ) : (
                  <>
                    You’re signed in as{' '}
                    <span className="font-medium text-foreground">
                      {session.email ?? 'this account'}
                    </span>
                    , which isn’t the administrator account. If you have a
                    second email for administration, sign out and sign back in
                    with that one.
                  </>
                )}
              </p>
              {notConfigured && (
                <p className="text-xs text-muted-foreground/80">
                  Technical detail for your developer: the server has no
                  <code className="mx-1 rounded bg-muted px-1 py-0.5">ADMIN_EMAIL</code>
                  configured.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1 pl-8">
            <Button
              variant="default"
              onClick={() => setLocation('/employee')}
              className="gap-2"
              data-testid="button-go-to-hours"
            >
              <Clock className="h-4 w-4" />
              Go to my hours
            </Button>
            <Button
              variant="outline"
              onClick={() => void signOut(() => setLocation('/'))}
              className="gap-2"
              data-testid="button-sign-out"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
