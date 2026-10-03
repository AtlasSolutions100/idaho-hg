import { ApiError } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Why a panel has no data, and what to do about it.
 *
 * Molly's report was that things "aren't working" with nothing saying why —
 * a screen that fails silently looks identical to one with nothing in it yet.
 * Every load that can fail renders this instead: the reason in her words, and
 * a Retry that refetches rather than making her reload the whole app.
 */
export function failureReason(error: unknown): string {
  if (error instanceof ApiError) {
    const code =
      error.data && typeof error.data === 'object'
        ? (error.data as { code?: string }).code
        : undefined;
    if (code === 'SIGN_IN_DISABLED') {
      return 'Your sign-in has been turned off. Ask Molly if you think this is a mistake.';
    }
    if (code === 'LINK_REQUEST_PENDING') {
      return "Molly still needs to confirm it's you. Check back in a bit.";
    }
    if (code === 'NOT_LINKED') {
      return "This email isn't linked to a team profile yet.";
    }
    if (error.status === 401) {
      return 'Your sign-in has expired. Sign in again to keep going.';
    }
    if (error.status === 403) {
      return "You're signed in, but this is only for Molly's administrator account.";
    }
    if (error.status === 404) {
      return "That isn't here any more — it may have been removed.";
    }
    if (error.status >= 500) {
      return 'Something went wrong on our side. Try again in a moment.';
    }
    const message =
      error.data && typeof error.data === 'object'
        ? (error.data as { message?: string }).message
        : undefined;
    if (message) return message;
  }
  // No response at all — far and away the most common case, and the one a
  // bare "failed to load" explains worst.
  return "Couldn't reach the server. Check your connection and try again.";
}

export function LoadFailure({
  what,
  error,
  onRetry,
  testId,
}: {
  /** What didn't load, named the way the screen names it ("client rates"). */
  what: string;
  error: unknown;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4 space-y-2"
      data-testid={testId ?? 'load-failure'}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-medium">Couldn’t load {what}</p>
          <p className="text-sm text-muted-foreground" data-testid="load-failure-reason">
            {failureReason(error)}
          </p>
        </div>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5 ml-6.5"
          data-testid="button-retry"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}
