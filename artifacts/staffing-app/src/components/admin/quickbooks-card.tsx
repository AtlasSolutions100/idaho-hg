import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useGetQboStatus,
  useDisconnectQbo,
  getGetQboStatusQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Link2, CircleCheck, CircleAlert } from 'lucide-react';

/**
 * QuickBooks connection card for the Admin dashboard.
 * Calm status + one clear action: Connect or Disconnect.
 */
type ConnectOutcome = 'error' | 'cancelled';

export function QuickBooksCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [connectOutcome, setConnectOutcome] = useState<ConnectOutcome | null>(null);

  // After Intuit sends Molly back, the server redirects to
  // /admin?quickbooks=connected|cancelled|error. Read it once, tell her what
  // happened in plain language, and clean the address bar so a refresh
  // doesn't repeat the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('quickbooks');
    if (!result) return;

    if (result === 'connected') {
      toast({
        title: 'QuickBooks connected',
        description: 'Your QuickBooks account is now linked. Invoices can be sent there.',
      });
      queryClient.invalidateQueries({ queryKey: getGetQboStatusQueryKey() });
    } else if (result === 'cancelled') {
      setConnectOutcome('cancelled');
    } else {
      setConnectOutcome('error');
    }

    params.delete('quickbooks');
    const rest = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}`,
    );
  }, [toast, queryClient]);
  const statusQuery = useGetQboStatus();
  const disconnect = useDisconnectQbo({
    mutation: {
      onSettled: () => queryClient.invalidateQueries({ queryKey: getGetQboStatusQueryKey() }),
    },
  });

  const status = statusQuery.data;

  return (
    <Card data-testid="card-quickbooks">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
            QuickBooks
          </CardTitle>
          {status &&
            (status.connected ? (
              <Badge variant="outline" className="border-primary/40 text-primary" data-testid="badge-qbo-connected">
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground" data-testid="badge-qbo-not-connected">
                Not connected
              </Badge>
            ))}
        </div>
        <CardDescription>
          Link your real QuickBooks account so invoices can be sent there later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connectOutcome === 'error' && (
          <Alert variant="destructive" className="mb-4" data-testid="alert-qbo-connect-error">
            <CircleAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>The QuickBooks connection didn't go through</AlertTitle>
            <AlertDescription>
              This usually happens when an older QuickBooks tab was still open. Close any other
              QuickBooks tabs, then click "Connect to QuickBooks" again in one fresh tab.
            </AlertDescription>
          </Alert>
        )}
        {connectOutcome === 'cancelled' && (
          <Alert className="mb-4" data-testid="alert-qbo-connect-cancelled">
            <CircleAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Connection cancelled</AlertTitle>
            <AlertDescription>
              You cancelled on the QuickBooks page, so nothing was connected. Click "Connect to
              QuickBooks" whenever you're ready to try again.
            </AlertDescription>
          </Alert>
        )}
        {statusQuery.isLoading ? (
          <Skeleton className="h-10 w-full max-w-md" />
        ) : statusQuery.isError || !status ? (
          <p className="text-sm text-muted-foreground" data-testid="text-qbo-error">
            Couldn't check the QuickBooks connection — refresh the page to try again.
          </p>
        ) : !status.configured && !status.connected ? (
          <p className="text-sm text-muted-foreground" data-testid="text-qbo-not-configured">
            One-time setup is still needed before you can connect: the app's QuickBooks
            credentials haven't been added yet. Send us a note through Team Feedback and
            we'll get it ready.
          </p>
        ) : status.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {status.problem ? (
                <CircleAlert className="h-5 w-5 text-amber-600 shrink-0" aria-hidden="true" />
              ) : (
                <CircleCheck className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
              )}
              <span data-testid="text-qbo-company">
                {status.problem
                  ? status.problem
                  : status.companyName
                    ? <>Connected to <span className="font-medium">{status.companyName}</span></>
                    : 'Connected to your QuickBooks account'}
              </span>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-qbo-disconnect">
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This app will no longer have access to your QuickBooks account. Nothing in
                    QuickBooks is changed or deleted — you can connect again any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep connected</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => disconnect.mutate()}
                    data-testid="button-qbo-disconnect-confirm"
                  >
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-qbo-explainer">
              {status.problem ??
                "You'll sign in on QuickBooks' own page and approve the connection there."}
            </p>
            <Button asChild size="sm" className="gap-1.5" data-testid="button-qbo-connect">
              <a href="/api/qbo/connect">
                <Link2 className="h-4 w-4" />
                Connect to QuickBooks
              </a>
            </Button>
          </div>
        )}
        {disconnect.isError && (
          <p className="mt-2 text-sm text-destructive" data-testid="text-qbo-disconnect-error">
            Something went wrong disconnecting — please try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
