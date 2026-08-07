import { useMemo, useState } from 'react';
import { useListTimeEntries, type TimeEntry } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { statusLabels, visitTypeLabels } from '@/lib/data';
import { format } from 'date-fns';
import { Calendar, MapPin, DollarSign, FileText, AlertCircle, Lock, Pencil, BellRing } from 'lucide-react';

interface TimeEntriesListProps {
  employeeId?: string;
  onEdit?: (entry: TimeEntry) => void;
}

// Client-side "I've seen Molly's adjustments up to this point" marker,
// per employee, so the heads-up banner only nags about NEW adjustments.
const seenKey = (employeeId: string) => `adjustments-seen:${employeeId}`;

function readSeenMarker(employeeId: string): string {
  try {
    return window.localStorage.getItem(seenKey(employeeId)) ?? '';
  } catch {
    return '';
  }
}

function writeSeenMarker(employeeId: string, iso: string) {
  try {
    window.localStorage.setItem(seenKey(employeeId), iso);
  } catch {
    // Private-mode/storage failures just mean the banner shows again later.
  }
}

/** Valid adminEditedAt timestamp, or null. */
function adjustedAt(entry: TimeEntry): number | null {
  if (!entry.adminEditedAt) return null;
  const t = new Date(entry.adminEditedAt).getTime();
  return Number.isNaN(t) ? null : t;
}

export function TimeEntriesList({ employeeId = '1', onEdit }: TimeEntriesListProps) {
  const { data: entries, isLoading, isError } = useListTimeEntries({ employeeId });
  const [seenMarker, setSeenMarker] = useState(() => readSeenMarker(employeeId));

  const seenTime = seenMarker ? new Date(seenMarker).getTime() : 0;
  const unseenAdjusted = useMemo(
    () =>
      (entries ?? []).filter(e => {
        const t = adjustedAt(e);
        return t !== null && t > seenTime;
      }),
    [entries, seenTime],
  );
  const unseenIds = new Set(unseenAdjusted.map(e => e.id));

  const dismissAdjustedCue = () => {
    const newest = Math.max(...unseenAdjusted.map(e => adjustedAt(e) ?? 0));
    const iso = new Date(newest).toISOString();
    writeSeenMarker(employeeId, iso);
    setSeenMarker(iso);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>Couldn't load your time entries.</p>
            <p className="text-sm mt-1">Please try refreshing the page.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Hours</CardTitle>
          <CardDescription>No time entries yet</CardDescription>
        </CardHeader>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>You haven't logged any hours yet.</p>
            <p className="text-sm mt-1">Tap "Log Hours" to get started.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {unseenAdjusted.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
          role="status"
          data-testid="banner-adjusted"
        >
          <BellRing className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium">
              Molly adjusted {unseenAdjusted.length === 1 ? 'one of your entries' : `${unseenAdjusted.length} of your entries`}
            </p>
            <p className="text-muted-foreground mt-0.5">
              Look for the “Adjusted” badge below to see what changed.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismissAdjustedCue}
            data-testid="button-dismiss-adjusted"
          >
            Got it
          </Button>
        </div>
      )}
      {entries.map(entry => (
        <TimeEntryCard
          key={entry.id}
          entry={entry}
          onEdit={onEdit}
          recentlyAdjusted={unseenIds.has(entry.id)}
        />
      ))}
    </div>
  );
}

function TimeEntryCard({
  entry,
  onEdit,
  recentlyAdjusted = false,
}: {
  entry: TimeEntry;
  onEdit?: (entry: TimeEntry) => void;
  recentlyAdjusted?: boolean;
}) {
  const getStatusColor = (status: TimeEntry['status']) => {
    switch (status) {
      case 'approved':
        return 'default';
      case 'submitted':
        return 'secondary';
      case 'rejected':
        return 'destructive';
      case 'draft':
        return 'outline';
      default:
        return 'outline';
    }
  };

  // Anything Molly hasn't approved yet can still be edited by its owner.
  const editable = entry.status !== 'approved';

  return (
    <Card className="transition-smooth hover:shadow-md" data-testid={`time-entry-${entry.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-medium">{entry.clientName}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {format(new Date(entry.date), 'MMM d, yyyy')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {recentlyAdjusted && (
              <Badge
                className="bg-primary/10 text-primary border-primary/30"
                variant="outline"
                data-testid={`badge-adjusted-${entry.id}`}
              >
                <BellRing className="h-3 w-3 mr-1" />
                Adjusted
              </Badge>
            )}
            <Badge variant={getStatusColor(entry.status)} data-testid={`status-${entry.id}`}>
              {statusLabels[entry.status]}
            </Badge>
            {editable && onEdit ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => onEdit(entry)}
                data-testid={`button-edit-${entry.id}`}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            ) : entry.status === 'approved' ? (
              <span
                className="flex items-center gap-1 text-xs text-muted-foreground"
                title="Approved entries are locked"
                data-testid={`locked-${entry.id}`}
              >
                <Lock className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          {entry.visitType && (
            <div className="space-y-1">
              <div className="text-muted-foreground">Visit Type</div>
              <div className="font-medium font-mono">{visitTypeLabels[entry.visitType]}</div>
            </div>
          )}
          {entry.hours ? (
            <div className="space-y-1">
              <div className="text-muted-foreground">Hours</div>
              <div className="font-medium font-mono">
                {entry.hours} hrs
                {entry.timeIn && entry.timeOut ? (
                  <span className="text-muted-foreground font-normal"> ({entry.timeIn}–{entry.timeOut})</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {entry.mileage && entry.mileage > 0 ? (
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Mileage
              </div>
              <div className="font-medium font-mono">{entry.mileage} mi</div>
            </div>
          ) : null}
          {entry.perDiem && entry.perDiem > 0 ? (
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Per Diem
              </div>
              <div className="font-medium font-mono">
                {entry.perDiemType === 'first_last'
                  ? 'First/Last day'
                  : entry.perDiemType === 'full'
                    ? 'Full day'
                    : `${entry.perDiem} day${entry.perDiem > 1 ? 's' : ''}`}
              </div>
            </div>
          ) : null}
        </div>

        {(entry.isWeekend || entry.isHoliday) && (
          <div className="flex gap-2 pt-1">
            {entry.isWeekend && (
              <Badge variant="outline" className="text-xs">Weekend Rate</Badge>
            )}
            {entry.isHoliday && (
              <Badge variant="outline" className="text-xs">Holiday Rate</Badge>
            )}
          </div>
        )}

        {entry.note && (
          <div className="pt-2 border-t">
            <p className="text-sm text-muted-foreground italic">{entry.note}</p>
          </div>
        )}

        {entry.adminEditedAt && !Number.isNaN(new Date(entry.adminEditedAt).getTime()) && (
          <div className="pt-2 border-t" data-testid={`admin-edit-${entry.id}`}>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Molly adjusted this entry
              </span>{' '}
              on {format(new Date(entry.adminEditedAt), 'MMM d, yyyy h:mm a')}
              {entry.adminEditSummary ? <> — {entry.adminEditSummary}</> : null}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
