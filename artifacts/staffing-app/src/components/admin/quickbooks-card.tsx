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
import { Link2, CircleCheck, CircleAlert, Copy, Check } from 'lucide-react';

// Remembers that Molly clicked Connect, so if Intuit never sends her back
// (usually because this address isn't registered in the Intuit portal) we can
// explain what went wrong instead of staying silent.
const CONNECT_ATTEMPT_KEY = 'qbo-connect-attempt';
// Only treat a not-completed attempt as worth mentioning if it happened
// recently. Older flags (Molly wandered off, came back the next day) are
// cleared quietly to avoid crying wolf.
const CONNECT_ATTEMPT_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * QuickBooks connection card for the Admin dashboard.
 * Calm status + one clear action: Connect or Disconnect.
 */
type ConnectOutcome = 'error' | 'cancelled' | 'never-returned';

export function QuickBooksCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [connectOutcome, setConnectOutcome] = useState<ConnectOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  // After Intuit sends Molly back, the server redirects to
  // /admin?quickbooks=connected|cancelled|error. Read it once, tell her what
  // happened in plain language, and clean the address bar so a refresh
  // doesn't repeat the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('quickbooks');
    if (!result) {
      // No result in the address bar — but if a connect attempt was started
      // and we're back here without one, Intuit never sent her back. That
      // almost always means this app's address isn't registered (or the
      // registration didn't stick) in the Intuit developer portal.
      const startedAt = Number(sessionStorage.getItem(CONNECT_ATTEMPT_KEY));
      if (startedAt) {
        sessionStorage.removeItem(CONNECT_ATTEMPT_KEY);
        // Only mention a recent attempt; a stale flag from long ago is
        // cleared without alarming anyone.
        if (Date.now() - startedAt < CONNECT_ATTEMPT_MAX_AGE_MS) {
          setConnectOutcome('never-returned');
        }
      }
      return;
    }
    sessionStorage.removeItem(CONNECT_ATTEMPT_KEY);

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
        {connectOutcome === 'never-returned' && (
          <Alert variant="destructive" className="mb-4" data-testid="alert-qbo-never-returned">
            <CircleAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>The last QuickBooks connection attempt didn't finish</AlertTitle>
            <AlertDescription>
              If you closed the QuickBooks page yourself, no problem — just try again. But if
              QuickBooks showed an error or never brought you back here, the usual cause is that
              this app's address below isn't saved in the Intuit developer portal (or the save
              didn't stick). Copy the address below, add it under your Intuit app's Redirect
              URIs, refresh that Intuit page to confirm it really saved, then try connecting
              again — in one tab only.
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
              <a
                href="/api/qbo/connect"
                onClick={() => sessionStorage.setItem(CONNECT_ATTEMPT_KEY, String(Date.now()))}
              >
                <Link2 className="h-4 w-4" />
                Connect to QuickBooks
              </a>
            </Button>
          </div>
        )}
        {!statusQuery.isLoading && status && !status.connected && status.configured && status.callbackUrl && (
          <div className="mt-4 rounded-md border bg-muted/40 p-3" data-testid="section-qbo-callback">
            <p className="text-xs font-medium mb-1">
              Before connecting works, Intuit needs this exact address saved in your Intuit
              developer app (Keys &amp; credentials → Redirect URIs):
            </p>
            <div className="flex items-center gap-2">
              <code
                className="text-xs break-all bg-background border rounded px-2 py-1 flex-1"
                data-testid="text-qbo-callback-url"
              >
                {status.callbackUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                data-testid="button-qbo-copy-callback"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(status.callbackUrl!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    toast({
                      title: "Couldn't copy automatically",
                      description: 'Select the address and copy it by hand instead.',
                      variant: 'destructive',
                    });
                  }
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Intuit's save button sometimes fails quietly — after saving, refresh their page and
              make sure the address is still listed. This address changes while the app is in
              development; once the app is published, register the permanent published address
              instead so this stops recurring.
            </p>
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
