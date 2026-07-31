import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { PayrollReportCard } from '@/components/admin/payroll-report-card';
import { InvoiceReportCard } from '@/components/admin/invoice-report-card';
import { ReconciliationReportCard } from '@/components/admin/reconciliation-report-card';
import { MissingRatesNotice } from '@/components/admin/missing-rates-notice';
import { ChevronLeft } from 'lucide-react';

export default function ReportsPage() {
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
              <h1 className="text-xl font-semibold">Reports</h1>
              <p className="text-sm text-muted-foreground">Generate payroll and client reports</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <MissingRatesNotice />
        <PayrollReportCard />
        <InvoiceReportCard />
        <ReconciliationReportCard />
      </div>
    </div>
  );
}
