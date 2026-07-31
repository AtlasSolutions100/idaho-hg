import { Link } from 'wouter';
import { useListFeedback } from '@workspace/api-client-react';
import type { FeedbackType } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, MessageSquare } from 'lucide-react';

const typeLabels: Record<FeedbackType, { label: string; className: string }> = {
  problem: {
    label: 'Problem',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
  idea: {
    label: 'Idea',
    className: 'bg-primary/10 text-primary border-primary/20',
  },
  other: {
    label: 'Other',
    className: 'bg-muted text-muted-foreground border-border',
  },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function FeedbackPage() {
  const feedbackQuery = useListFeedback();

  const items = [...(feedbackQuery.data ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold">Team Feedback</h1>
              <p className="text-sm text-muted-foreground">
                What your team has sent from the feedback button
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {feedbackQuery.isLoading ? (
          <div className="space-y-4" data-testid="feedback-loading">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : feedbackQuery.isError ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="feedback-error">
              Couldn't load feedback right now. Please try again in a moment.
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-14 flex flex-col items-center text-center gap-3" data-testid="feedback-empty">
              <div className="p-3 rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-6 w-6" />
              </div>
              <div>
                <p className="font-medium">No feedback yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  When your team sends feedback from the app, it will show up here.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const badge = typeLabels[item.type] ?? typeLabels.other;
              return (
                <Card key={item.id} data-testid={`feedback-item-${item.id}`}>
                  <CardContent className="pt-6">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="outline" className={badge.className}>
                        {badge.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{item.message}</p>
                    <p className="text-xs text-muted-foreground mt-3">
                      {item.name?.trim() ? `From ${item.name}` : 'Anonymous'}
                      {item.page ? ` · on ${item.page}` : ''}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
