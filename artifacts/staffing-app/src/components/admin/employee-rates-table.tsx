import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { mockEmployeeRates } from '@/lib/data';
import { Pencil } from 'lucide-react';

export function EmployeeRatesTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Pay Rates</CardTitle>
        <CardDescription>
          Current pay rates for all active employees
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Hourly</TableHead>
                <TableHead className="text-right">Visit</TableHead>
                <TableHead className="text-right">Mileage</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Weekend</TableHead>
                <TableHead className="text-right">Holiday</TableHead>
                <TableHead className="text-right">Effective</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockEmployeeRates.map(rate => (
                <TableRow key={rate.id} data-testid={`employee-rate-${rate.id}`}>
                  <TableCell className="font-medium">
                    <div>{rate.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{rate.employeeRole}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${rate.hourlyRate.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${rate.visitRate.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${rate.mileageRate.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${rate.perDiemRate.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {rate.weekendMultiplier}x
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {rate.holidayMultiplier}x
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {rate.effectiveDate}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-2"
                      data-testid={`button-edit-employee-rate-${rate.id}`}
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
      </CardContent>
    </Card>
  );
}
