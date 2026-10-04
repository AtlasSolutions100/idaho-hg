import { Suspense, lazy, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/theme-provider';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';

// Everything past the welcome screen loads on demand. These eleven pages pull
// in the whole admin surface — tables, reports, PDF and invoice machinery —
// and bundling them into the first download is what made the app crawl on the
// 1 Oct call. The welcome screen now ships on its own; each screen arrives
// when it is opened.
const EmployeeDashboard = lazy(() => import('@/pages/employee-dashboard'));
const AdminDashboard = lazy(() => import('@/pages/admin-dashboard'));
const ApprovePayrollPage = lazy(() => import('@/pages/admin/approve-payroll'));
const ClientRatesPage = lazy(() => import('@/pages/admin/client-rates'));
const VisitTypesPage = lazy(() => import('@/pages/admin/visit-types'));
const VisitPayRatesPage = lazy(() => import('@/pages/admin/visit-pay-rates'));
const EmployeeRatesPage = lazy(() => import('@/pages/admin/employee-rates'));
const ReportsPage = lazy(() => import('@/pages/admin/reports'));
const OnboardingPage = lazy(() => import('@/pages/admin/onboarding'));
const FeedbackPage = lazy(() => import('@/pages/admin/feedback'));
const BusinessSettingsPage = lazy(() => import('@/pages/admin/business-settings'));
const TravelAllowancesPage = lazy(() => import('@/pages/admin/travel-allowances'));
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { FeedbackDialog } from '@/components/feedback-dialog';
import { AdminAccessDenied } from '@/components/access-denied';
import { LoadFailure } from '@/components/load-failure';
import { useSession } from '@/lib/use-session';
import { Loader2 } from 'lucide-react';

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

// Everything past the welcome screen needs a session. The server no longer
// serves or accepts anyone's hours without one — time entries carry names,
// pay, mileage and per diem — so an unauthenticated page would only be able to
// render errors. Sign-in is the gate; the server decides what each session is
// actually allowed to see.
function SignedInGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

/** Centered spinner for a whole page that isn't ready yet. */
function FullPageLoading({ label }: { label: string }) {
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center gap-2 text-muted-foreground"
      data-testid="text-page-loading"
    >
      <Loader2 className="h-5 w-5 animate-spin" />
      {label}
    </div>
  );
}

/**
 * Admin pages need Molly specifically — the server only accepts approvals,
 * rates and report reads from the configured administrator's session.
 *
 * This used to be an alias for SignedInGate, which let any signed-in person
 * walk into the admin screens and watch every panel inside them fail with no
 * explanation. That is what Molly hit. The gate now asks the server who she
 * is, and the three answers each get their own screen: still checking, we
 * couldn't ask, and you are not the administrator (with the reason).
 */
function AdminGateInner({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, error, refetch } = useSession();

  if (isPending) return <FullPageLoading label="Checking your access…" />;

  if (error || !session) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <LoadFailure
            what="your account"
            error={error}
            onRetry={() => void refetch()}
            testId="admin-session-failure"
          />
        </div>
      </div>
    );
  }

  if (!session.isAdmin) return <AdminAccessDenied session={session} />;

  return <>{children}</>;
}

function AdminGate({ children }: { children: React.ReactNode }) {
  return (
    <SignedInGate>
      <AdminGateInner>{children}</AdminGateInner>
    </SignedInGate>
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
    <Suspense fallback={<FullPageLoading label="Loading…" />}>
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/employee">
        <SignedInGate>
          <EmployeeDashboard />
        </SignedInGate>
      </Route>
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
      <Route path="/admin/visit-types">
        <AdminGate>
          <VisitTypesPage />
        </AdminGate>
      </Route>
      <Route path="/admin/visit-pay-rates">
        <AdminGate>
          <VisitPayRatesPage />
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
      <Route path="/admin/travel-allowances">
        <AdminGate>
          <TravelAllowancesPage />
        </AdminGate>
      </Route>
      <Route path="/admin/business-settings">
        <AdminGate>
          <BusinessSettingsPage />
        </AdminGate>
      </Route>
      <Route component={NotFound} />
    </Switch>
    </Suspense>
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
