import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBusinessSettings,
  useUpdateBusinessSettings,
  getGetBusinessSettingsQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, Building2, Loader2 } from 'lucide-react';

export default function BusinessSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useGetBusinessSettings();
  const updateSettings = useUpdateBusinessSettings();

  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('1');
  const [loadedFromServer, setLoadedFromServer] = useState(false);

  // Fill the form once from the saved settings; afterwards the form is the
  // source of truth until Save.
  useEffect(() => {
    if (settingsQuery.data && !loadedFromServer) {
      setAddress(settingsQuery.data.address);
      setPhone(settingsQuery.data.phone);
      setEmail(settingsQuery.data.email);
      setPaymentTerms(settingsQuery.data.paymentTerms);
      setNextInvoiceNumber(String(settingsQuery.data.nextInvoiceNumber));
      setLoadedFromServer(true);
    }
  }, [settingsQuery.data, loadedFromServer]);

  const parsedNumber = Number(nextInvoiceNumber);
  const numberValid = Number.isInteger(parsedNumber) && parsedNumber >= 1;

  const save = () => {
    if (!numberValid) return;
    updateSettings.mutate(
      {
        data: { address, phone, email, paymentTerms, nextInvoiceNumber: parsedNumber },
      },
      {
        onSuccess: (saved) => {
          setAddress(saved.address);
          setPhone(saved.phone);
          setEmail(saved.email);
          setPaymentTerms(saved.paymentTerms);
          setNextInvoiceNumber(String(saved.nextInvoiceNumber));
          void queryClient.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
          toast({ title: 'Settings saved', description: 'New PDF invoices will use these details.' });
        },
        onError: () => {
          toast({
            title: "Couldn't save settings",
            description: 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

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
              <h1 className="text-xl font-semibold">Business Settings</h1>
              <p className="text-sm text-muted-foreground">
                Details printed on your PDF invoices
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>Invoice details</CardTitle>
                <CardDescription>
                  These appear in the header of every PDF invoice you download. Leave a field
                  blank to keep it off the invoice.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {settingsQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="business-address">Business address</Label>
                  <Textarea
                    id="business-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={'123 Main St\nBoise, ID 83702'}
                    rows={3}
                    data-testid="input-business-address"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="business-phone">Phone</Label>
                    <Input
                      id="business-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(208) 555-0100"
                      data-testid="input-business-phone"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="business-email">Email</Label>
                    <Input
                      id="business-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="billing@example.com"
                      data-testid="input-business-email"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payment-terms">Payment terms</Label>
                  <Input
                    id="payment-terms"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="Net 30"
                    data-testid="input-payment-terms"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="next-invoice-number">Next invoice number</Label>
                  <Input
                    id="next-invoice-number"
                    type="number"
                    min={1}
                    step={1}
                    value={nextInvoiceNumber}
                    onChange={(e) => setNextInvoiceNumber(e.target.value)}
                    data-testid="input-next-invoice-number"
                  />
                  <p className="text-xs text-muted-foreground">
                    The number the next downloaded PDF invoice will get. It counts up
                    automatically after each download.
                  </p>
                  {!numberValid && (
                    <p className="text-sm text-destructive">
                      Must be a whole number of at least 1.
                    </p>
                  )}
                </div>
                <div className="pt-2">
                  <Button
                    onClick={save}
                    disabled={updateSettings.isPending || !numberValid}
                    className="gap-2"
                    data-testid="button-save-business-settings"
                  >
                    {updateSettings.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save settings
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
