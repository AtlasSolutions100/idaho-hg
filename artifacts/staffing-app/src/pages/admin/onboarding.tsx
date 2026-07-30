import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { OnboardingChecklist } from '@/components/admin/onboarding-checklist';
import { ChevronLeft } from 'lucide-react';

export default function OnboardingPage() {
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
              <h1 className="text-xl font-semibold">Onboarding</h1>
              <p className="text-sm text-muted-foreground">New hire setup and documentation</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <OnboardingChecklist />
      </div>
    </div>
  );
}
