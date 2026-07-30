import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LogHoursForm } from '@/components/employee/log-hours-form';
import { TimeEntriesList } from '@/components/employee/time-entries-list';
import { Plus, Clock, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function EmployeeDashboard() {
  const [showForm, setShowForm] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const { toast } = useToast();

  const handleSubmit = () => {
    setShowForm(false);
    setSubmittedCount(prev => prev + 1);
    toast({
      title: 'Hours submitted',
      description: 'Your time entry has been submitted for approval.',
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Log Hours</h1>
              <p className="text-sm text-muted-foreground">Sarah Martinez</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-primary" />
              <span className="font-mono font-medium">2 submitted</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {showForm ? (
          <LogHoursForm
            onSubmit={handleSubmit}
            onCancel={() => setShowForm(false)}
          />
        ) : (
          <>
            <Button
              onClick={() => setShowForm(true)}
              className="w-full gap-2 h-14 text-base"
              size="lg"
              data-testid="button-log-hours"
            >
              <Plus className="h-5 w-5" />
              Log Hours
            </Button>

            <div className="pt-2">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Your Submitted Hours</h2>
              </div>
              <TimeEntriesList employeeId="1" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
