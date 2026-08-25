// Client-side PDF invoice generator. Mirrors the on-screen invoice lines and
// the CSV export exactly (same InvoiceReport data source) — do not reformat
// or recompute amounts here.
//
// Layout follows Molly's real QuickBooks invoices (see
// attached_assets/Idaho_Youth_ranch_Invoice_*.pdf): green "INVOICE" heading
// with the business block top-left and the Idaho logo top-right, a pale green
// "Bill to / Ship to" band, an "Invoice details" block, then a numbered line
// table with a bold total. QuickBooks' "Ways to pay" button is intentionally
// omitted — we don't process payments.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { InvoiceReport } from '@workspace/api-client-react';
import { formatMoney } from '@/lib/report-csv';
import { ihsLogoDataUri } from '@/assets/ihs-logo';

// Colors sampled from the real invoice.
const GREEN_DARK: [number, number, number] = [58, 106, 32]; // headings/accents
const GREEN_PALE: [number, number, number] = [234, 241, 234]; // section bands
const TEXT_DARK: [number, number, number] = [40, 40, 40];
const TEXT_MUTED: [number, number, number] = [100, 100, 100];

// Same rate formatting as the CSV/table: mileage-style rates get 3 decimals.
function formatRate(rate: number): string {
  return rate.toFixed(Number.isInteger(rate * 100) ? 2 : 3);
}

/** "2026-07-27" -> "07/27/2026" (QuickBooks date style). */
function qbDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function todayIso(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Due date from "Net 30"-style terms; null when terms aren't Net N. */
function dueDateFromTerms(invoiceIso: string, terms: string): string | null {
  const match = /net\s*(\d+)/i.exec(terms);
  if (!match) return null;
  const [y, m, d] = invoiceIso.split('-').map(Number);
  const due = new Date(y!, m! - 1, d! + Number(match[1]));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${due.getFullYear()}-${p(due.getMonth() + 1)}-${p(due.getDate())}`;
}

export interface InvoiceBusinessDetails {
  address: string;
  phone: string;
  email: string;
  paymentTerms: string;
}

export interface InvoiceBillTo {
  /** Optional contact person, shown above the client name (QuickBooks style). */
  billingContact?: string;
  /** Optional multi-line billing address, shown below the client name. */
  billingAddress?: string;
}

export function downloadInvoicePdf(
  report: InvoiceReport,
  details?: InvoiceBusinessDetails,
  invoiceNumber?: number,
  billTo?: InvoiceBillTo,
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;

  // ---- Header: INVOICE + business block (left), contact (middle), logo (right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...GREEN_DARK);
  doc.text('INVOICE', margin, 58);

  // Business name is intentionally fixed: the business-details settings
  // (task: business details + invoice number) cover address/phone/email/terms
  // only, and the app is single-tenant for Idaho Healthcare Staffing.
  const leftColW = 180;
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Idaho Healthcare Staffing', margin, 74);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  let leftY = 74;
  for (const raw of (details?.address ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    for (const line of doc.splitTextToSize(raw, leftColW) as string[]) {
      leftY += 12;
      doc.text(line, margin, leftY);
    }
  }

  // Middle column: email + phone, like the real invoice — sits just to the
  // right of the business-name column, aligned to the business-name baseline.
  const midX = margin + 135;
  const midColW = pageWidth - margin - 60 - midX;
  let midY = 62;
  for (const raw of [details?.email ?? '', details?.phone ?? ''].map((s) => s.trim()).filter(Boolean)) {
    for (const line of doc.splitTextToSize(raw, midColW) as string[]) {
      midY += 12;
      doc.text(line, midX, midY);
    }
  }

  // Logo top-right (teal Idaho outline, 111x154 source → keep aspect).
  const logoW = 40;
  const logoH = (154 / 111) * logoW;
  try {
    doc.addImage(ihsLogoDataUri, 'PNG', pageWidth - margin - logoW, 40, logoW, logoH);
  } catch {
    // A corrupt/unsupported logo must never block invoice downloads.
  }

  const headerBottom = Math.max(leftY, midY, 40 + logoH) + 18;

  // ---- One continuous pale-green region holds the Bill to / Ship to block
  // and the Invoice details block, separated by a light dashed divider —
  // exactly how QuickBooks lays them out on Molly's real invoices. The band
  // is full-bleed; the divider is inset by the page margin. Bill to shows the
  // optional billing contact above the client name and the billing address
  // below it; clients without those fields show the name only. Long lines
  // wrap and the band grows to fit.
  const bandPad = 12;
  const colW = contentWidth / 2 - 16;
  doc.setFontSize(8.5);
  const billToRaw = [
    ...(billTo?.billingContact?.trim() ? [billTo.billingContact.trim()] : []),
    report.clientName,
    ...(billTo?.billingAddress ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const nameLines = billToRaw.flatMap(
    (raw) => doc.splitTextToSize(raw, colW) as string[],
  );

  // Invoice details lines. QuickBooks lists only these four — there is no
  // "service period" line; the per-line date ranges live in the description
  // column instead.
  const invoiceDate = todayIso();
  const terms = (details?.paymentTerms ?? '').trim() || 'Net 30';
  const dueIso = dueDateFromTerms(invoiceDate, terms);
  const detailLines = [
    ...(invoiceNumber != null ? [`Invoice no.: ${invoiceNumber}`] : []),
    `Terms: ${terms}`,
    `Invoice date: ${qbDate(invoiceDate)}`,
    ...(dueIso ? [`Due date: ${qbDate(dueIso)}`] : []),
  ];

  // Geometry: Bill-to sub-block, a dashed divider gap, then the Invoice-details
  // sub-block, all inside a single filled rectangle.
  const bandTop = headerBottom;
  const billBlockH = bandPad + 14 + nameLines.length * 11 + bandPad;
  const dividerGap = 16;
  const detailsBlockH = 20 + detailLines.length * 13 + bandPad;
  const bandH = billBlockH + dividerGap + detailsBlockH;
  const dividerY = bandTop + billBlockH + dividerGap / 2;
  const detailsTop = bandTop + billBlockH + dividerGap;

  doc.setFillColor(...GREEN_PALE);
  doc.rect(0, bandTop, pageWidth, bandH, 'F');

  // Bill to / Ship to headings and lines (Ship to mirrors Bill to).
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_DARK);
  doc.text('Bill to', margin, bandTop + bandPad + 2);
  doc.text('Ship to', margin + contentWidth / 2, bandTop + bandPad + 2);
  doc.setFont('helvetica', 'normal');
  nameLines.forEach((line, i) => {
    const y = bandTop + bandPad + 16 + i * 11;
    doc.text(line, margin, y);
    doc.text(line, margin + contentWidth / 2, y);
  });

  // Dashed divider between the two sub-blocks, inset by the page margin.
  doc.setDrawColor(176, 190, 176);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(margin, dividerY, pageWidth - margin, dividerY);
  doc.setLineDashPattern([], 0);

  // Invoice details heading and lines.
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_DARK);
  doc.text('Invoice details', margin, detailsTop + 16);
  doc.setFont('helvetica', 'normal');
  detailLines.forEach((line, i) => {
    doc.text(line, margin, detailsTop + 30 + i * 13);
  });

  // ---- Numbered line table — same content as the CSV export. Missing-rate
  // lines keep the explicit "NO RATE ON FILE" flag and are tinted amber.
  const body = report.lines.map((line, i) => [
    `${i + 1}.`,
    qbDate(line.date),
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
    startY: bandTop + bandH + 18,
    margin: { left: margin, right: margin },
    head: [['#', 'Date', 'Product or service', 'Description', 'Qty', 'Rate', 'Amount']],
    body,
    theme: 'plain',
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 8, bottom: 8, left: 4, right: 4 },
      textColor: TEXT_DARK,
      lineColor: [225, 225, 225],
      lineWidth: { bottom: 0.5 },
    },
    headStyles: {
      fontStyle: 'bold',
      textColor: TEXT_DARK,
      lineColor: [180, 180, 180],
      lineWidth: { bottom: 1 },
    },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 62 },
      2: { fontStyle: 'bold' },
      4: { halign: 'right', cellWidth: 34 },
      5: { halign: 'right', cellWidth: 54 },
      6: { halign: 'right', cellWidth: 64 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && missingRows.has(data.row.index)) {
        data.cell.styles.fillColor = [254, 243, 199]; // amber-100
        data.cell.styles.textColor = [146, 64, 14]; // amber-800
      }
    },
  });

  // ---- Total row, bold and right-aligned like the real invoice.
  // Page-safe: if the table ended near the bottom, move to a fresh page so the
  // total and any warning never render off-page.
  const afterTableY =
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? bandTop + bandH + 18;
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerSpaceNeeded = 24 + (report.missingRateCount > 0 ? 24 + 12 : 12);
  let totalY = afterTableY + 24;
  if (totalY + footerSpaceNeeded - 24 > pageHeight - margin) {
    doc.addPage();
    totalY = margin + 24;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Total', pageWidth - margin - 150, totalY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(formatMoney(report.total), pageWidth - margin, totalY, { align: 'right' });
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.75);
  doc.line(pageWidth - margin - 220, totalY - 16, pageWidth - margin, totalY - 16);

  // Missing-rate warning below the total, so the PDF never hides $0 billing.
  if (report.missingRateCount > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(
      report.missingRateCount === 1
        ? 'Warning: 1 line has no billing rate on file and is billed at $0.'
        : `Warning: ${report.missingRateCount} lines have no billing rate on file and are billed at $0.`,
      margin,
      totalY + 24,
    );
    doc.setTextColor(0);
  }

  // ---- Optional per-client "Note to customer" footer, like Molly's QuickBooks
  // invoices (e.g. Weiser's "Time cards will be sent for reconciliation…").
  if (report.noteToCustomer && report.noteToCustomer.trim()) {
    let noteY = totalY + (report.missingRateCount > 0 ? 44 : 24);
    const noteLines = doc.splitTextToSize(report.noteToCustomer.trim(), pageWidth - margin * 2);
    if (noteY + noteLines.length * 12 > pageHeight - margin) {
      doc.addPage();
      noteY = margin + 24;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    doc.text(noteLines, margin, noteY);
    doc.setTextColor(0);
  }

  doc.save(`invoice-${report.clientName.replace(/\s+/g, '-').toLowerCase()}-${report.start}-to-${report.end}.pdf`);
}
