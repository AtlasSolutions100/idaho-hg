import { useQueryClient } from '@tanstack/react-query';
import {
  useListLinkRequests,
  useApproveLinkRequest,
  useDenyLinkRequest,
  getListLinkRequestsQueryKey,
  getListEmployeesQueryKey,
  getListEmployeeRatesQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, UserPlus, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * Pending "that's me" requests from the mobile app: an employee signed in
 * with their own email and picked their name. Molly approves (links the
 * email to the profile) or denies with one tap.
 */
export function LinkRequestsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useListLinkRequests();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListLinkRequestsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEmployeeRatesQueryKey() });
  };

  const serverMessage = (error: unknown): string | null =>
    error && typeof error === 'object' && 'data' in error &&
    error.data && typeof error.data === 'object' && 'message' in error.data &&
    typeof (error.data as { message?: unknown }).message === 'string'
      ? (error.data as { message: string }).message
      : null;

  const approveMutation = useApproveLinkRequest({
    mutation: {
      onSuccess: (employee) => {
        invalidate();
        toast({
          title: 'Linked',
          description: `${employee.name} can now sign in with ${employee.email}. Nothing else to do.`,
        });
      },
      onError: (error) => {
        invalidate();
        toast({
          title: 'Could not approve',
          description: serverMessage(error) ?? 'Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const denyMutation = useDenyLinkRequest({
    mutation: {
      onSuccess: (request) => {
        invalidate();
        toast({
          title: 'Request denied',
          description: `${request.email} stays blocked. They can ask you directly if this was a mistake.`,
        });
      },
      onError: (error) => {
        invalidate();
        toast({
          title: 'Could not deny',
          description: serverMessage(error) ?? 'Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  // Only show the card when there's something to act on (or while loading
  // an existing list) — no point in an empty card on every visit.
  if (isLoading || !requests || requests.length === 0) return null;

  const busy = approveMutation.isPending || denyMutation.isPending;

  return (
    <Card className="border-primary/40" data-testid="card-link-requests">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Someone wants to join
          <Badge>{requests.length}</Badge>
        </CardTitle>
        <CardDescription>
          These people signed in to the app and picked their name from your
          team. Approve to link their email and the discipline they picked —
          you won't need to type either in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map((request) => (
          <div
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            data-testid={`link-request-${request.id}`}
          >
            <div>
              <div className="font-medium">
                {request.employeeName}
                <span className="ml-2 text-xs text-muted-foreground">{request.employeeRole}</span>
                {/* What they said their profession is. Shown next to the
                    profile's own so a disagreement is visible before Molly
                    approves — approving accepts their answer. */}
                {request.claimedDiscipline &&
                  request.claimedDiscipline !== request.employeeRole && (
                    <span
                      className="ml-2 text-xs text-amber-700 dark:text-amber-500"
                      data-testid={`claimed-discipline-${request.id}`}
                    >
                      says they're {request.claimedDiscipline}
                    </span>
                  )}
              </div>
              <div className="text-sm text-muted-foreground">{request.email}</div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => approveMutation.mutate({ id: request.id })}
                data-testid={`button-approve-link-${request.id}`}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Yes, that's them
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => denyMutation.mutate({ id: request.id })}
                data-testid={`button-deny-link-${request.id}`}
              >
                <X className="h-3.5 w-3.5" />
                Deny
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
