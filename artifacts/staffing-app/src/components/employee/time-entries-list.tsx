import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { mockTimeEntries, statusLabels, visitTypeLabels, type TimeEntry } from '@/lib/data';
import { format } from 'date-fns';
import { Calendar, MapPin, DollarSign, FileText } from 'lucide-react';

interface TimeEntriesListProps {
  employeeId?: string;
}

export function TimeEntriesList({ employeeId = '1' }: TimeEntriesListProps) {
  const entries = mockTimeEntries
    .filter(e => e.employeeId === employeeId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Submitted Hours</CardTitle>
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
      {entries.map(entry => (
        <TimeEntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function TimeEntryCard({ entry }: { entry: TimeEntry }) {
  const getStatusColor = (status: TimeEntry['status']) => {
    switch (status) {
      case 'approved':
        return 'default';
      case 'submitted':
        return 'secondary';
      case 'rejected':
        return 'destructive';
      default:
        return 'outline';
    }
  };

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
          <Badge variant={getStatusColor(entry.status)} data-testid={`status-${entry.id}`}>
            {statusLabels[entry.status]}
          </Badge>
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
          {entry.hours && (
            <div className="space-y-1">
              <div className="text-muted-foreground">Hours</div>
              <div className="font-medium font-mono">{entry.hours} hrs</div>
            </div>
          )}
          {entry.mileage && entry.mileage > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Mileage
              </div>
              <div className="font-medium font-mono">{entry.mileage} mi</div>
            </div>
          )}
          {entry.perDiem && entry.perDiem > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Per Diem
              </div>
              <div className="font-medium font-mono">{entry.perDiem} day{entry.perDiem > 1 ? 's' : ''}</div>
            </div>
          )}
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
      </CardContent>
    </Card>
  );
}
