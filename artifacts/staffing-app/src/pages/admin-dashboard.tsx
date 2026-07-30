import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  CheckSquare, 
  DollarSign, 
  Users, 
  FileSpreadsheet, 
  ClipboardList,
  ChevronRight 
} from 'lucide-react';

export default function AdminDashboard() {
  const quickActions = [
    {
      title: 'Approve Payroll',
      description: 'Review and approve pending time entries',
      icon: CheckSquare,
      href: '/admin/approve-payroll',
      count: 5,
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
          <div>
            <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Hodge Staffing Management</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
              <CardTitle className="text-3xl font-mono">127.5</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Hours submitted</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Pending Review</CardDescription>
              <CardTitle className="text-3xl font-mono">5</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Time entries</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Active Employees</CardDescription>
              <CardTitle className="text-3xl font-mono">6</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Currently staffing</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
