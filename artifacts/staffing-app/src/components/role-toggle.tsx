import { useLocation } from 'wouter';
import { useSession } from '@/lib/use-session';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, Clock } from 'lucide-react';

/**
 * Switch between the administrator screens and the employee screens.
 *
 * Molly asked for this on the 1 Oct call — "Am I going to be able to toggle
 * between employee and admin?" — because she needs to see what her staff see
 * while still approving their hours. It renders only for the administrator;
 * for everyone else there is nothing to switch to, and showing a dead control
 * would just raise the question of why it doesn't work.
 */
export function RoleToggle({ current }: { current: 'admin' | 'employee' }) {
  const [, setLocation] = useLocation();
  const { data: session } = useSession();

  if (!session?.isAdmin) return null;

  const onAdmin = current === 'admin';

  return (
    <div
      className="inline-flex items-center rounded-lg border bg-muted/50 p-0.5"
      role="group"
      aria-label="Switch between administrator and employee views"
      data-testid="role-toggle"
    >
      <Button
        variant={onAdmin ? 'default' : 'ghost'}
        size="sm"
        className="gap-1.5 h-7 px-2.5"
        aria-pressed={onAdmin}
        onClick={() => setLocation('/admin')}
        data-testid="button-view-admin"
      >
        <ClipboardCheck className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Admin</span>
      </Button>
      <Button
        variant={onAdmin ? 'ghost' : 'default'}
        size="sm"
        className="gap-1.5 h-7 px-2.5"
        aria-pressed={!onAdmin}
        onClick={() => setLocation('/employee')}
        data-testid="button-view-employee"
      >
        <Clock className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">My hours</span>
      </Button>
    </div>
  );
}
