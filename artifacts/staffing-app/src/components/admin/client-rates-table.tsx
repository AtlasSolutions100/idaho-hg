import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { mockClientRates, visitTypeLabels } from '@/lib/data';
import { Pencil } from 'lucide-react';

export function ClientRatesTable() {
  // Group by client
  const clientGroups = mockClientRates.reduce((acc, rate) => {
    if (!acc[rate.clientId]) {
      acc[rate.clientId] = [];
    }
    acc[rate.clientId].push(rate);
    return acc;
  }, {} as Record<string, typeof mockClientRates>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Rates</CardTitle>
        <CardDescription>
          Billing rates by client and visit type
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {Object.entries(clientGroups).map(([clientId, rates]) => (
            <div key={clientId}>
              <h3 className="font-medium mb-3">{rates[0].clientName}</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Visit Type</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Effective Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rates.map(rate => (
                      <TableRow key={rate.id} data-testid={`client-rate-${rate.id}`}>
                        <TableCell>{visitTypeLabels[rate.visitType]}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          ${rate.rate.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {rate.effectiveDate}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-2"
                            data-testid={`button-edit-client-rate-${rate.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
