// Client-side PDF invoice generator. Mirrors the on-screen invoice lines and
// the CSV export exactly (same InvoiceReport data source) — do not reformat
// or recompute amounts here.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { InvoiceReport } from '@workspace/api-client-react';
import { formatMoney } from '@/lib/report-csv';

// Same rate formatting as the CSV/table: mileage-style rates get 3 decimals.
function formatRate(rate: number): string {
  return rate.toFixed(Number.isInteger(rate * 100) ? 2 : 3);
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y!.slice(2)}`;
}

export interface InvoiceBusinessDetails {
  address: string;
  phone: string;
  email: string;
  paymentTerms: string;
}
export function downloadInvoicePdf(
  report: InvoiceReport,
  details?: InvoiceBusinessDetails,
  invoiceNumber?: number,
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  // Header: business name + invoice metadata.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Idaho Healthcare Staffing', margin, 64);
  doc.setFontSize(14);
  doc.setTextColor(100);
  doc.text('INVOICE', pageWidth - margin, 64, { align: 'right' });

  // Business contact lines under the name (only the ones Molly filled in).
  let leftY = 64;
  const contactLines = [
    ...(details?.address ?? '').split(/\r?\n/),
    details?.phone ?? '',
    details?.email ?? '',
  ].map((s) => s.trim()).filter((s) => s !== '');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  for (const line of contactLines) {
    leftY += 13;
    doc.text(line, margin, leftY);
  }

  // Invoice number under the INVOICE label.
  let rightY = 64;
  if (invoiceNumber != null) {
    rightY += 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Invoice #${invoiceNumber}`, pageWidth - margin, rightY, { align: 'right' });
  }

  const metaTop = Math.max(leftY, rightY) + 32;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('Bill to:', margin, metaTop);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(report.clientName, margin, metaTop + 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  doc.text(
    `Invoice period: ${longDate(report.start)} – ${longDate(report.end)}`,
    pageWidth - margin, metaTop, { align: 'right' },
  );
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    pageWidth - margin, metaTop + 14, { align: 'right' },
  );
  const paymentTerms = details?.paymentTerms.trim() ?? '';
  if (paymentTerms !== '') {
    doc.text(`Payment terms: ${paymentTerms}`, pageWidth - margin, metaTop + 28, { align: 'right' });
  }
  const tableStartY = metaTop + (paymentTerms !== '' ? 28 : 14) + 22;

  // Line table — same columns and content as the CSV export. Missing-rate
  // lines keep the explicit "NO RATE ON FILE" flag and are tinted amber.
  const body = report.lines.map((line) => [
    shortDate(line.date),
    line.productService,
    line.missingRate ? `${line.description} — NO RATE ON FILE` : line.description,
    String(line.qty),
    line.rate != null ? `$${formatRate(line.rate)}` : '—',
    formatMoney(line.amount),
  ]);

  const missingRows = new Set(
    report.lines.flatMap((line, i) => (line.missingRate ? [i] : [])),
  );

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [['Date', 'Product or service', 'Description', 'Qty', 'Rate', 'Amount']],
    body,
    foot: [['', '', 'Grand total', '', '', formatMoney(report.total)]],
    styles: { fontSize: 9, cellPadding: 5, textColor: 20 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && missingRows.has(data.row.index)) {
        data.cell.styles.fillColor = [254, 243, 199]; // amber-100
        data.cell.styles.textColor = [146, 64, 14]; // amber-800
      }
      if (data.section === 'foot' && (data.column.index === 2 || data.column.index === 5)) {
        data.cell.styles.halign = data.column.index === 5 ? 'right' : 'left';
      }
    },
  });

  // Missing-rate warning below the table, so the PDF never hides $0 billing.
  const afterTableY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableStartY;
  if (report.missingRateCount > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(
      report.missingRateCount === 1
        ? 'Warning: 1 line has no billing rate on file and is billed at $0.'
        : `Warning: ${report.missingRateCount} lines have no billing rate on file and are billed at $0.`,
      margin,
      afterTableY + 20,
    );
    doc.setTextColor(0);
  }

  doc.save(`invoice-${report.clientName.replace(/\s+/g, '-').toLowerCase()}-${report.start}-to-${report.end}.pdf`);
}
