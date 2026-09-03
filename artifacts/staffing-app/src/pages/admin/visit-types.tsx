import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { VisitTypesTable } from '@/components/admin/visit-types-table';
import { DisciplinesTable } from '@/components/admin/disciplines-table';
import { ChevronLeft } from 'lucide-react';

export default function VisitTypesPage() {
  return (
    <div className="min-h-[100dvh] bg-background">
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
              <h1 className="text-xl font-semibold">Visit Types &amp; Disciplines</h1>
              <p className="text-sm text-muted-foreground">
                What employees can log, and which profession each one is for
              </p>
            </div>
          </div>
        </div>
      </div>
      <div
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8"
        data-testid="visit-types-content"
      >
        <VisitTypesTable />
        {/* Disciplines sit under the visit types because narrowing a visit type
            to a discipline is the common reason to come looking for this list. */}
        <DisciplinesTable />
      </div>
    </div>
  );
}
