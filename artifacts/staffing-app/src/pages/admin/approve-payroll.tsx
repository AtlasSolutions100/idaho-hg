import { Link } from 'wouter';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ApprovePayrollTable } from '@/components/admin/approve-payroll-table';
import { currentPeriodKey } from '@/components/admin/workflow-progress';
import { ChevronLeft } from 'lucide-react';

export default function ApprovePayrollPage() {
  // Monday of the actual current week — never a typed-in date.
  const [y, m, d] = currentPeriodKey().split('-').map(Number);
  const weekLabel = format(new Date(y, m - 1, d), 'MMM d, yyyy');
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
              <h1 className="text-xl font-semibold">Approve Payroll</h1>
              <p className="text-sm text-muted-foreground" data-testid="text-current-week">
                Week of {weekLabel}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ApprovePayrollTable />
      </div>
    </div>
  );
}
