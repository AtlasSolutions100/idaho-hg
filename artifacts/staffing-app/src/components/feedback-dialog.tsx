import { useState } from 'react';
import { useCreateFeedback } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MessageSquarePlus } from 'lucide-react';

const typeOptions = [
  { value: 'problem', label: 'Something is broken' },
  { value: 'idea', label: 'An idea or request' },
  { value: 'other', label: 'Something else' },
] as const;

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'problem' | 'idea' | 'other'>('idea');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [location] = useLocation();
  const { toast } = useToast();
  const createFeedback = useCreateFeedback();

  const send = () => {
    createFeedback.mutate(
      {
        data: {
          type,
          message: message.trim(),
          ...(name.trim() !== '' ? { name: name.trim() } : {}),
          page: location,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setMessage('');
          toast({ title: 'Thanks — we got it', description: 'Your feedback was sent to the developers.' });
        },
        onError: () => {
          toast({
            title: "Couldn't send your feedback",
            description: 'Please try again in a moment.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Wrapper handles positioning: the button itself can't be `fixed`
          because the design system's hover-elevate styles force
          `position: relative` on buttons. */}
      <div className="fixed bottom-4 right-4 z-50">
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shadow-md bg-background"
            data-testid="button-open-feedback"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Send feedback
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Tell the developers what's broken, confusing, or missing. It goes straight to them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label id="feedback-type-label">What kind of feedback?</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger aria-labelledby="feedback-type-label" data-testid="select-feedback-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="feedback-message">Your message</Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, or what would you like to see?"
              rows={4}
              data-testid="input-feedback-message"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feedback-name">Your name (optional)</Label>
            <Input
              id="feedback-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="So we know who to follow up with"
              data-testid="input-feedback-name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={send}
            disabled={message.trim() === '' || createFeedback.isPending}
            className="gap-2"
            data-testid="button-send-feedback"
          >
            {createFeedback.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
