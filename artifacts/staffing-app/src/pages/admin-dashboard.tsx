import { Link } from 'wouter';
import { useListEmployees, useListTimeEntries } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeToggle } from '@/components/theme-toggle';
import { PracticeDataCard } from '@/components/admin/practice-data-card';
import { NextStepsCard } from '@/components/admin/next-steps-card';
import { 
  CheckSquare, 
  DollarSign, 
  Users, 
  FileSpreadsheet, 
  ClipboardList,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { useLocation } from 'wouter';

// Monday–Sunday week containing today, as YYYY-MM-DD bounds
function currentWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(monday), end: fmt(sunday) };
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const employeesQuery = useListEmployees();
  const entriesQuery = useListTimeEntries();

  const entries = entriesQuery.data ?? [];
  const pendingCount = entries.filter((e) => e.status === 'submitted').length;

  const { start, end } = currentWeekRange();
  const weekEntries = entries.filter((e) => e.date >= start && e.date <= end);
  const weekHours = weekEntries.reduce((sum, e) => sum + (e.hours ?? 0), 0);
  const weekVisits = weekEntries.filter((e) => e.visitType).length;
  const weekLabel =
    weekVisits > 0
      ? `${weekHours % 1 === 0 ? weekHours : weekHours.toFixed(1)} hrs · ${weekVisits} visit${weekVisits === 1 ? '' : 's'}`
      : `${weekHours % 1 === 0 ? weekHours : weekHours.toFixed(1)}`;

  const statsLoading = entriesQuery.isLoading || employeesQuery.isLoading;

  const quickActions = [
    {
      title: 'Approve Payroll',
      description: 'Review and approve pending time entries',
      icon: CheckSquare,
      href: '/admin/approve-payroll',
      count: entriesQuery.isLoading ? undefined : pendingCount,
      testId: 'link-approve-payroll',
    },
    {
      title: 'Client Rates',
      description: 'Manage billing rates by client',
      icon: DollarSign,
      href: '/admin/client-rates',
      testId: 'link-client-rates',
    },
    {
      title: 'Employee Rates',
      description: 'Manage employee pay rates',
      icon: Users,
      href: '/admin/employee-rates',
      testId: 'link-employee-rates',
    },
    {
      title: 'Reports',
      description: 'Generate payroll and client reports',
      icon: FileSpreadsheet,
      href: '/admin/reports',
      testId: 'link-reports',
    },
    {
      title: 'Onboarding',
      description: 'New hire checklist and tasks',
      icon: ClipboardList,
      href: '/admin/onboarding',
      testId: 'link-onboarding',
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Hodge Staffing Management</p>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation('/')}
                className="gap-1.5 text-muted-foreground"
                aria-label="Exit to welcome screen"
                data-testid="button-exit"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Exit</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Weekly workflow guidance */}
        <div className="mb-8">
          <NextStepsCard />
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href} data-testid={action.testId}>
                <Card className="h-full transition-smooth hover:shadow-lg hover:border-primary/50 cursor-pointer group">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-smooth">
                        <Icon className="h-6 w-6" />
                      </div>
                      {action.count !== undefined && (
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold font-mono">
                          {action.count}
                        </div>
                      )}
                    </div>
                    <CardTitle className="mt-4 group-hover:text-primary transition-smooth">
                      {action.title}
                    </CardTitle>
                    <CardDescription>{action.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm font-medium text-primary">
                      Open
                      <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* Quick Stats */}
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>This Week</CardDescription>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <CardTitle className="text-3xl font-mono" data-testid="stat-week">
                  {weekLabel}
                </CardTitle>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {weekVisits > 0 ? 'Submitted this week' : 'Hours submitted'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Pending Review</CardDescription>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <CardTitle className="text-3xl font-mono" data-testid="stat-pending">
                  {pendingCount}
                </CardTitle>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Time entries</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Active Employees</CardDescription>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <CardTitle className="text-3xl font-mono" data-testid="stat-active-employees">
                  {employeesQuery.data?.length ?? 0}
                </CardTitle>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Currently staffing</p>
            </CardContent>
          </Card>
        </div>

        {/* Practice data */}
        <div className="mt-8">
          <PracticeDataCard />
        </div>
      </div>
    </div>
  );
}
