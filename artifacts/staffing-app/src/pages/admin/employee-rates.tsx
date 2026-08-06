import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { EmployeeRatesTable } from '@/components/admin/employee-rates-table';
import { LinkRequestsCard } from '@/components/admin/link-requests-card';
import { ChevronLeft } from 'lucide-react';

export default function EmployeeRatesPage() {
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
              <h1 className="text-xl font-semibold">Employees</h1>
              <p className="text-sm text-muted-foreground">Contact info, app sign-in, and pay rates in one place</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <LinkRequestsCard />
        <EmployeeRatesTable />
      </div>
    </div>
  );
}
