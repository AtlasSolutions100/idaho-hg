import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Download, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ReportPlaceholderProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  fields?: { label: string; type: string; placeholder?: string }[];
}

export function ReportPlaceholder({ title, description, icon, fields }: ReportPlaceholderProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          {icon && (
            <div className="p-3 rounded-lg bg-primary/10 text-primary">
              {icon}
            </div>
          )}
          <div className="flex-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields && fields.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field, idx) => (
              <div key={idx} className="space-y-2">
                <Label htmlFor={`field-${idx}`}>{field.label}</Label>
                <Input
                  id={`field-${idx}`}
                  type={field.type}
                  placeholder={field.placeholder}
                  data-testid={`input-${field.label.toLowerCase().replace(/\s/g, '-')}`}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <Button className="gap-2" data-testid={`button-generate-${title.toLowerCase().replace(/\s/g, '-')}`}>
            <FileSpreadsheet className="h-4 w-4" />
            Generate Report
          </Button>
          <Button variant="outline" className="gap-2" data-testid={`button-download-${title.toLowerCase().replace(/\s/g, '-')}`}>
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PayrollExportReport() {
  return (
    <ReportPlaceholder
      title="Payroll Export (Pezwise)"
      description="Generate payroll list for Pezwise import"
      icon={<FileSpreadsheet className="h-6 w-6" />}
      fields={[
        { label: 'Pay Period Start', type: 'date' },
        { label: 'Pay Period End', type: 'date' },
      ]}
    />
  );
}

export function ClientInvoiceReport() {
  return (
    <ReportPlaceholder
      title="Client Invoice Summary"
      description="Invoice-style summary for client billing"
      icon={<FileSpreadsheet className="h-6 w-6" />}
      fields={[
        { label: 'Client', type: 'text', placeholder: 'Select client' },
        { label: 'Invoice Period Start', type: 'date' },
        { label: 'Invoice Period End', type: 'date' },
      ]}
    />
  );
}

export function ClientReconciliationReport() {
  return (
    <ReportPlaceholder
      title="Client Reconciliation"
      description="Detailed reconciliation with descriptive notes per visit"
      icon={<FileSpreadsheet className="h-6 w-6" />}
      fields={[
        { label: 'Client', type: 'text', placeholder: 'Select client' },
        { label: 'Period Start', type: 'date' },
        { label: 'Period End', type: 'date' },
      ]}
    />
  );
}
