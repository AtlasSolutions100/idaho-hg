import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleSwitcher, type UserRole } from '@/components/role-switcher';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

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
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <CardTitle className="text-2xl">Hodge Staffing</CardTitle>
            <CardDescription className="mt-2">Time tracking for healthcare professionals</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Select your role</label>
            <RoleSwitcher currentRole={role} onRoleChange={setRole} />
          </div>

          <div className="pt-2">
            <p className="text-sm text-muted-foreground mb-4">
              {role === 'employee' 
                ? 'Log your hours, mileage, and per diem for client visits.'
                : 'Review time entries, manage rates, and generate payroll reports.'}
            </p>
            <Button
              onClick={handleContinue}
              className="w-full gap-2"
              size="lg"
              data-testid="button-continue"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
