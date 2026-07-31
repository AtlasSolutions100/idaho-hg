import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/theme-provider';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import EmployeeDashboard from '@/pages/employee-dashboard';
import AdminDashboard from '@/pages/admin-dashboard';
import ApprovePayrollPage from '@/pages/admin/approve-payroll';
import ClientRatesPage from '@/pages/admin/client-rates';
import EmployeeRatesPage from '@/pages/admin/employee-rates';
import ReportsPage from '@/pages/admin/reports';
import OnboardingPage from '@/pages/admin/onboarding';
import FeedbackPage from '@/pages/admin/feedback';
import BusinessSettingsPage from '@/pages/admin/business-settings';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { FeedbackDialog } from '@/components/feedback-dialog';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/employee" component={EmployeeDashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/approve-payroll" component={ApprovePayrollPage} />
      <Route path="/admin/client-rates" component={ClientRatesPage} />
      <Route path="/admin/employee-rates" component={EmployeeRatesPage} />
      <Route path="/admin/reports" component={ReportsPage} />
      <Route path="/admin/onboarding" component={OnboardingPage} />
      <Route path="/admin/feedback" component={FeedbackPage} />
      <Route path="/admin/business-settings" component={BusinessSettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
          <FeedbackDialog />
        </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
