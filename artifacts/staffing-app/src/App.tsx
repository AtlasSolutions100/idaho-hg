import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
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
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { FeedbackDialog } from '@/components/feedback-dialog';

const queryClient = new QueryClient();

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev (Clerk hits dev FAPI directly),
// auto-set in prod. Do NOT gate on PROD/NODE_ENV.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(150 28% 48%)',
    colorForeground: 'hsl(215 28% 20%)',
    colorMutedForeground: 'hsl(215 16% 41%)',
    colorDanger: 'hsl(0 65% 50%)',
    colorBackground: 'hsl(0 0% 100%)',
    colorInput: 'hsl(0 0% 100%)',
    colorInputForeground: 'hsl(215 28% 20%)',
    colorNeutral: 'hsl(214 18% 87%)',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[hsl(215_28%_20%)]',
    headerSubtitle: 'text-[hsl(215_16%_41%)]',
    socialButtonsBlockButtonText: 'text-[hsl(215_28%_20%)]',
    formFieldLabel: 'text-[hsl(215_28%_20%)]',
    footerActionLink: 'text-[hsl(150_28%_38%)]',
    footerActionText: 'text-[hsl(215_16%_41%)]',
    dividerText: 'text-[hsl(215_16%_41%)]',
    identityPreviewEditButton: 'text-[hsl(150_28%_38%)]',
    formFieldSuccessText: 'text-[hsl(150_28%_38%)]',
    alertText: 'text-[hsl(215_28%_20%)]',
    logoBox: 'justify-center',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'border-[hsl(214_18%_87%)]',
    formButtonPrimary: 'bg-[hsl(150_28%_48%)] hover:bg-[hsl(150_28%_42%)]',
    formFieldInput: 'border-[hsl(214_18%_82%)]',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(214_18%_87%)]',
    alert: 'border-[hsl(214_18%_87%)]',
    otpCodeFieldInput: 'border-[hsl(214_18%_82%)] text-[hsl(215_28%_20%)]',
    formFieldRow: 'gap-2',
    main: 'gap-5',
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

// Admin pages need Molly signed in — the server only accepts approve/deny,
// email, and sign-in-access changes from the configured admin's session.
function AdminGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

// Keeps the webview up-to-date when the signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/employee" component={EmployeeDashboard} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/admin">
        <AdminGate>
          <AdminDashboard />
        </AdminGate>
      </Route>
      <Route path="/admin/approve-payroll">
        <AdminGate>
          <ApprovePayrollPage />
        </AdminGate>
      </Route>
      <Route path="/admin/client-rates">
        <AdminGate>
          <ClientRatesPage />
        </AdminGate>
      </Route>
      <Route path="/admin/employee-rates">
        <AdminGate>
          <EmployeeRatesPage />
        </AdminGate>
      </Route>
      <Route path="/admin/reports">
        <AdminGate>
          <ReportsPage />
        </AdminGate>
      </Route>
      <Route path="/admin/onboarding">
        <AdminGate>
          <OnboardingPage />
        </AdminGate>
      </Route>
      <Route path="/admin/feedback">
        <AdminGate>
          <FeedbackPage />
        </AdminGate>
      </Route>
      <Route path="/admin/business-settings">
        <AdminGate>
          <BusinessSettingsPage />
        </AdminGate>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to manage time tracking and billing',
          },
        },
        signUp: {
          start: {
            title: 'Create your account',
            subtitle: 'Idaho Healthcare Staffing',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Router />
        <FeedbackDialog />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
