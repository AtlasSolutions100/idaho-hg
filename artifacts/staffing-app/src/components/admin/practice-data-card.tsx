import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDemoDataStatus,
  useLoadDemoData,
  useRemoveDemoData,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FlaskConical, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function PracticeDataCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const statusQuery = useGetDemoDataStatus();
  const status = statusQuery.data;

  const refreshAll = () => queryClient.invalidateQueries();

  const loadMutation = useLoadDemoData({
    mutation: {
      onSuccess: (s) => {
        refreshAll();
        toast({
          title: 'Demo data loaded',
          description: `${s.clientCount} demo clients, ${s.employeeCount} demo employees, and ${s.entryCount} sample time entries are ready — plus rate history, a join request, onboarding progress, feedback, and an example invoice.`,
        });
      },
      onError: () =>
        toast({ title: 'Could not load demo data', description: 'Please try again.', variant: 'destructive' }),
    },
  });

  const removeMutation = useRemoveDemoData({
    mutation: {
      onSuccess: () => {
        refreshAll();
        toast({
          title: 'Demo data removed',
          description: 'All demo records are gone. Your real clients and employees were not touched.',
        });
      },
      onError: () =>
        toast({ title: 'Could not remove demo data', description: 'Please try again.', variant: 'destructive' }),
    },
  });

  const busy = loadMutation.isPending || removeMutation.isPending;

  return (
    <Card data-testid="card-practice-data">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Practice Data</CardTitle>
          {status?.loaded && (
            <Badge variant="secondary" className="font-normal" data-testid="badge-demo-loaded">
              {status.entryCount} demo entries loaded
            </Badge>
          )}
        </div>
        <CardDescription>
          Try out every part of the app with clearly labeled practice records: demo clients with
          billing addresses, demo employees with contact info and pay-rate history, two months of
          time entries (including some waiting for approval), a pending join request, onboarding
          checklist progress, sample feedback, and an example sent invoice. Everything is removed
          with one click — your real data is never touched.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => loadMutation.mutate()}
          disabled={busy || Boolean(status?.loaded)}
          className="gap-2"
          data-testid="button-load-demo-data"
        >
          {loadMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {status?.loaded ? 'Demo data is loaded' : 'Load demo data'}
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirmRemove(true)}
          disabled={busy || !status?.loaded}
          className="gap-2 text-destructive hover:text-destructive"
          data-testid="button-remove-demo-data"
        >
          {removeMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Remove all demo data
        </Button>
      </CardContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              Every practice record will be deleted: demo clients, demo employees, their time
              entries and rates, the sample join request, onboarding progress, sample feedback,
              and the example invoice — including any practice entries you logged against demo
              records. Real clients and employees are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              data-testid="button-confirm-remove-demo"
            >
              Remove demo data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
