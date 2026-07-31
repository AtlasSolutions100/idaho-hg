import { useState } from 'react';
import { useLocation } from 'wouter';
import { RoleSwitcher, type UserRole } from '@/components/role-switcher';
import { Button } from '@/components/ui/button';
import { ArrowRight, Clock } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function Home() {
  const [role, setRole] = useState<UserRole>('employee');
  const [, setLocation] = useLocation();

  const handleContinue = () => {
    if (role === 'employee') {
      setLocation('/employee');
    } else {
      setLocation('/admin');
    }
  };

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-b from-background via-background to-accent/40 dark:to-accent/20">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <main className="w-full max-w-md">
        <div className="rounded-2xl bg-card border border-card-border shadow-lg px-8 py-10 sm:px-10 sm:py-12">
          {/* Icon */}
          <div className="mx-auto w-20 h-20 rounded-full bg-accent flex items-center justify-center ring-8 ring-accent/40">
            <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
              <Clock className="w-7 h-7 text-primary" strokeWidth={1.75} />
            </div>
          </div>

          {/* Heading */}
          <div className="text-center mt-7 space-y-2">
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground">
              Idaho Healthcare Staffing
            </h1>
            <p className="text-sm text-muted-foreground">
              Time tracking for healthcare professionals
            </p>
          </div>

          {/* Role selection */}
          <div className="mt-9 space-y-2.5">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              I am signing in as
            </span>
            <RoleSwitcher currentRole={role} onRoleChange={setRole} />
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground/90 min-h-10 pt-1">
              {role === 'employee'
                ? 'Log your hours, mileage, and per diem for client visits.'
                : 'Review time entries, manage rates, and generate payroll reports.'}
            </p>
          </div>

          {/* Continue */}
          <Button
            onClick={handleContinue}
            className="w-full gap-2 mt-4 h-11 text-[0.9375rem] shadow-sm"
            size="lg"
            data-testid="button-continue"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6">
          Idaho Healthcare Staffing · Internal time &amp; billing
        </p>
      </main>
    </div>
  );
}
