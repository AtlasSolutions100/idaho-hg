import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { ApprovePayrollTable } from '@/components/admin/approve-payroll-table';
import { ChevronLeft } from 'lucide-react';

export default function ApprovePayrollPage() {
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
              <p className="text-sm text-muted-foreground">Week of Jan 15, 2024</p>
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
