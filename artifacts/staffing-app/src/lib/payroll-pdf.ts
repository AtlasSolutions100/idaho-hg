// Client-side PDF payroll generator. Produces the two documents Molly emails
// when she submits payroll:
//   1. downloadEmployeePayrollPdf — one employee's own pay statement.
//   2. downloadMasterPayrollPdf   — the master sheet listing everyone.
//
// Mirrors the client-facing invoice PDF (src/lib/invoice-pdf.ts): same jsPDF +
// jspdf-autotable setup, the green/pale-green Idaho Healthcare Staffing header
// with the logo top-right, the same money formatting (formatMoney) and page
// margins. Amounts come straight from the payroll report — never recomputed
// here — so the PDF, the on-screen table and the Pezwise CSV always agree.
//
// Pure module: no React. Visit-type labels are resolved by a `labelFor`
// callback passed in via opts (the caller wires it to the useVisitTypes hook),
// falling back to the static catalog so a direct call still renders friendly
// labels for the built-in keys.

import { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type CellDef } from 'jspdf-autotable';
import type {
  PayrollReport,
  PayrollReportEmployee,
  PayrollReportLine,
} from '@workspace/api-client-react';
import { formatMoney } from '@/lib/report-csv';
import { visitTypeLabels } from '@/lib/data';
import { ihsLogoDataUri } from '@/assets/ihs-logo';

// Colors sampled from the real invoice (kept in sync with invoice-pdf.ts).
const GREEN_DARK: [number, number, number] = [58, 106, 32]; // headings/accents
const GREEN_PALE: [number, number, number] = [234, 241, 234]; // section bands
const TEXT_DARK: [number, number, number] = [40, 40, 40];
const TEXT_MUTED: [number, number, number] = [100, 100, 100];
const AMBER_FILL: [number, number, number] = [254, 243, 199]; // amber-100
const AMBER_TEXT: [number, number, number] = [146, 64, 14]; // amber-800

// Single-tenant app: the business name is fixed, exactly like the invoice PDF.
const BUSINESS_NAME = 'Idaho Healthcare Staffing';
const MARGIN = 48;

/** Pay period for the statement header — the report carries these too. */
export interface PayrollPeriod {
  start: string;
  end: string;
}

/** Optional employer contact block, printed under the business name. */
export interface PayrollBusinessDetails {
  address?: string;
  phone?: string;
  email?: string;
}

export interface PayrollPdfOptions {
  /** Employer contact details (from business settings). Header shows name only when omitted. */
  business?: PayrollBusinessDetails;
  /** Resolve a visit-type key to its catalog label. Defaults to the static catalog. */
  labelFor?: (key: string | null | undefined) => string;
}

const defaultLabelFor = (key: string | null | undefined): string =>
  key ? (visitTypeLabels[key] ?? key) : '';

/** "2026-07-27" -> "07/27/2026" (matches the invoice PDF's date style). */
function qbDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * "Sarah Martinez" -> "Martinez-Sarah" for the filename. Last token is the
 * surname; everything before it is the given name(s). Sanitized to safe
 * filename characters.
 */
function nameForFile(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const ordered =
    parts.length >= 2 ? [parts[parts.length - 1]!, ...parts.slice(0, -1)] : parts;
  const joined = ordered.join('-').replace(/[^A-Za-z0-9-]/g, '');
  return joined || 'employee';
}

/**
 * Type-cell text for a line: the visit-type label (or "Other …" / "Hourly"),
 * with a weekend/holiday premium suffix and an explicit missing-rate flag so a
 * $0 line is never silent — the same convention the invoice PDF uses.
 */
function lineTypeText(
  line: PayrollReportLine,
  labelFor: (key: string | null | undefined) => string,
): string {
  let base: string;
  if (line.isOther) {
    base = line.description ? `Other — ${line.description}` : 'Other';
  } else if (line.visitType) {
    base = labelFor(line.visitType);
  } else {
    base = 'Hourly';
  }

  const flags: string[] = [];
  if (line.isWeekend) flags.push('Weekend');
  if (line.isHoliday) flags.push('Holiday');
  if (flags.length > 0) {
    const mult = line.multiplier > 1 ? ` ×${line.multiplier}` : '';
    base += ` (${flags.join(' + ')}${mult})`;
  }
  if (line.missingRate) {
    base += line.isOther ? ' — NEEDS AMOUNT' : ' — NO RATE ON FILE';
  }
  return base;
}

/** Quantity/hours cell: hours when logged, otherwise "1" for a single visit/other. */
function qtyHoursText(line: PayrollReportLine): string {
  if (line.hours != null) return String(line.hours);
  if (line.isOther || line.visitType) return '1';
  return '—';
}

/** The 8 money/detail cells for one line, shared by both documents. */
function lineCells(
  line: PayrollReportLine,
  labelFor: (key: string | null | undefined) => string,
): string[] {
  return [
    qbDate(line.date),
    line.clientName,
    lineTypeText(line, labelFor),
    qtyHoursText(line),
    formatMoney(line.basePay),
    formatMoney(line.mileagePay),
    formatMoney(line.perDiemPay),
    formatMoney(line.total),
  ];
}

const LINE_HEAD: RowInput[] = [
  ['Date', 'Client', 'Type', 'Qty / Hrs', 'Base', 'Mileage', 'Per diem', 'Total'],
];

// Column layout shared by both tables (content width 516pt on US letter).
const COLUMN_STYLES = {
  0: { cellWidth: 56 },
  3: { halign: 'right' as const, cellWidth: 38 },
  4: { halign: 'right' as const, cellWidth: 50 },
  5: { halign: 'right' as const, cellWidth: 50 },
  6: { halign: 'right' as const, cellWidth: 50 },
  7: { halign: 'right' as const, cellWidth: 58, fontStyle: 'bold' as const },
};

const BODY_STYLES = {
  fontSize: 8.5,
  cellPadding: { top: 6, bottom: 6, left: 4, right: 4 },
  textColor: TEXT_DARK,
  lineColor: [225, 225, 225] as [number, number, number],
  lineWidth: { bottom: 0.5 },
};

const HEAD_STYLES = {
  fontStyle: 'bold' as const,
  textColor: TEXT_DARK,
  lineColor: [180, 180, 180] as [number, number, number],
  lineWidth: { bottom: 1 },
};

const FOOT_STYLES = {
  fontStyle: 'bold' as const,
  textColor: TEXT_DARK,
  fillColor: [255, 255, 255] as [number, number, number],
  lineColor: [180, 180, 180] as [number, number, number],
  lineWidth: { top: 1 },
};

/**
 * Draws the branded header (green title left, business block under it, Idaho
 * logo right) and returns the Y coordinate just below it. Shared by both PDFs.
 */
function drawBrandHeader(
  doc: jsPDF,
  pageWidth: number,
  title: string,
  business?: PayrollBusinessDetails,
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...GREEN_DARK);
  doc.text(title, MARGIN, 56);

  const leftColW = 220;
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  doc.text(BUSINESS_NAME, MARGIN, 74);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  let leftY = 74;
  const contactLines = [
    ...(business?.address ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    ...[business?.phone, business?.email].map((s) => (s ?? '').trim()).filter(Boolean),
  ];
  for (const raw of contactLines) {
    for (const line of doc.splitTextToSize(raw, leftColW) as string[]) {
      leftY += 12;
      doc.text(line, MARGIN, leftY);
    }
  }

  // Logo top-right (teal Idaho outline, 111x154 source → keep aspect).
  const logoW = 40;
  const logoH = (154 / 111) * logoW;
  try {
    doc.addImage(ihsLogoDataUri, 'PNG', pageWidth - MARGIN - logoW, 40, logoW, logoH);
  } catch {
    // A corrupt/unsupported logo must never block payroll downloads.
  }

  return Math.max(leftY, 40 + logoH) + 18;
}

/** Pale-green info band with a bold first line and muted detail lines below. */
function drawInfoBand(
  doc: jsPDF,
  pageWidth: number,
  top: number,
  heading: string,
  detailLines: string[],
): number {
  const bandH = 20 + 4 + detailLines.length * 13 + 10;
  doc.setFillColor(...GREEN_PALE);
  doc.rect(0, top, pageWidth, bandH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(heading, MARGIN, top + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  detailLines.forEach((line, i) => {
    doc.text(line, MARGIN, top + 34 + i * 13);
  });
  doc.setTextColor(...TEXT_DARK);
  return top + bandH;
}

/** Small page footer with a page number — the master sheet often spans pages. */
function drawPageFooter(doc: jsPDF, pageWidth: number, pageHeight: number): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(`${BUSINESS_NAME} · Payroll`, MARGIN, pageHeight - 24);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 24, {
      align: 'right',
    });
  }
  doc.setTextColor(...TEXT_DARK);
}

function lastTableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback
  );
}

/**
 * One employee's pay statement: branded header, an employee/pay-period band, a
 * table of their lines, a totals foot row, and a bold net-pay line. Downloads
 * as `payroll-{Last-First}-{start}-to-{end}.pdf`.
 */
export function downloadEmployeePayrollPdf(
  employee: PayrollReportEmployee,
  period: PayrollPeriod,
  opts?: PayrollPdfOptions,
): void {
  const labelFor = opts?.labelFor ?? defaultLabelFor;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const headerBottom = drawBrandHeader(doc, pageWidth, 'Payroll Statement', opts?.business);
  const missingCount = employee.lines.filter((l) => l.missingRate).length;
  const bandBottom = drawInfoBand(
    doc,
    pageWidth,
    headerBottom,
    `${employee.employeeName} · ${employee.employeeRole}`,
    [
      `Pay period: ${qbDate(period.start)} – ${qbDate(period.end)}`,
      `${employee.visitCount} visit${employee.visitCount === 1 ? '' : 's'} · ${employee.totalHours} hr`,
    ],
  );

  const missingRows = new Set(
    employee.lines.flatMap((line, i) => (line.missingRate ? [i] : [])),
  );

  autoTable(doc, {
    startY: bandBottom + 18,
    margin: { left: MARGIN, right: MARGIN },
    head: LINE_HEAD,
    body: employee.lines.map((line) => lineCells(line, labelFor)),
    foot: [
      [
        { content: 'Totals', colSpan: 4, styles: { halign: 'right' } },
        formatMoney(employee.basePay),
        formatMoney(employee.mileagePay),
        formatMoney(employee.perDiemPay),
        formatMoney(employee.total),
      ],
    ],
    theme: 'plain',
    styles: BODY_STYLES,
    headStyles: HEAD_STYLES,
    footStyles: FOOT_STYLES,
    columnStyles: COLUMN_STYLES,
    didParseCell: (data) => {
      if (data.section === 'body' && missingRows.has(data.row.index)) {
        data.cell.styles.fillColor = AMBER_FILL;
        data.cell.styles.textColor = AMBER_TEXT;
      }
    },
  });

  // Bold net-pay line below the table, page-safe like the invoice total.
  let totalY = lastTableFinalY(doc, bandBottom + 18) + 26;
  const footerNeeded = 24 + (missingCount > 0 ? 24 : 0);
  if (totalY + footerNeeded > pageHeight - MARGIN) {
    doc.addPage();
    totalY = MARGIN + 24;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Net pay', pageWidth - MARGIN - 160, totalY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(formatMoney(employee.total), pageWidth - MARGIN, totalY, { align: 'right' });
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.75);
  doc.line(pageWidth - MARGIN - 230, totalY - 16, pageWidth - MARGIN, totalY - 16);

  if (missingCount > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(
      missingCount === 1
        ? 'Warning: 1 line has no pay rate on file and is paid at $0.'
        : `Warning: ${missingCount} lines have no pay rate on file and are paid at $0.`,
      MARGIN,
      totalY + 24,
    );
    doc.setTextColor(0);
  }

  drawPageFooter(doc, pageWidth, pageHeight);
  doc.save(
    `payroll-${nameForFile(employee.employeeName)}-${period.start}-to-${period.end}.pdf`,
  );
}

/**
 * The master sheet: every employee grouped under a header row with their own
 * line rows and a subtotal, then a grand total. One paginating table so long
 * payrolls flow across pages cleanly. Downloads as
 * `payroll-master-{start}-to-{end}.pdf`.
 */
export function downloadMasterPayrollPdf(
  report: PayrollReport,
  period: PayrollPeriod,
  opts?: PayrollPdfOptions,
): void {
  const labelFor = opts?.labelFor ?? defaultLabelFor;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const headerBottom = drawBrandHeader(doc, pageWidth, 'Payroll Master Sheet', opts?.business);
  const bandBottom = drawInfoBand(
    doc,
    pageWidth,
    headerBottom,
    `All employees (${report.employees.length})`,
    [
      `Pay period: ${qbDate(period.start)} – ${qbDate(period.end)}`,
      `${report.entryCount} entr${report.entryCount === 1 ? 'y' : 'ies'} · Grand total ${formatMoney(report.grandTotal)}`,
    ],
  );

  // Build the interleaved body: employee header row, line rows, subtotal row.
  // Track which body-row indices are missing-rate lines so didParseCell can
  // tint them without re-deriving positions.
  const body: RowInput[] = [];
  const missingRows = new Set<number>();
  let rowIndex = 0;

  const empHeaderCell = (text: string): CellDef => ({
    content: text,
    colSpan: 8,
    styles: { fontStyle: 'bold', fillColor: GREEN_PALE, textColor: TEXT_DARK },
  });

  for (const emp of report.employees) {
    body.push([empHeaderCell(`${emp.employeeName} · ${emp.employeeRole}`)]);
    rowIndex++;

    for (const line of emp.lines) {
      if (line.missingRate) missingRows.add(rowIndex);
      body.push(lineCells(line, labelFor));
      rowIndex++;
    }

    body.push([
      {
        content: `${emp.employeeName} — subtotal (${emp.visitCount} visit${emp.visitCount === 1 ? '' : 's'}, ${emp.totalHours} hr)`,
        colSpan: 4,
        styles: { halign: 'right', fontStyle: 'bold' },
      },
      { content: formatMoney(emp.basePay), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: formatMoney(emp.mileagePay), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: formatMoney(emp.perDiemPay), styles: { halign: 'right', fontStyle: 'bold' } },
      {
        content: formatMoney(emp.total),
        styles: { halign: 'right', fontStyle: 'bold', fillColor: GREEN_PALE },
      },
    ]);
    rowIndex++;
  }

  const grandBase = report.employees.reduce((s, e) => s + e.basePay, 0);
  const grandMileage = report.employees.reduce((s, e) => s + e.mileagePay, 0);
  const grandPerDiem = report.employees.reduce((s, e) => s + e.perDiemPay, 0);

  autoTable(doc, {
    startY: bandBottom + 18,
    margin: { left: MARGIN, right: MARGIN },
    head: LINE_HEAD,
    body,
    foot: [
      [
        {
          content: `Grand total (${report.entryCount} entr${report.entryCount === 1 ? 'y' : 'ies'})`,
          colSpan: 4,
          styles: { halign: 'right' },
        },
        formatMoney(grandBase),
        formatMoney(grandMileage),
        formatMoney(grandPerDiem),
        formatMoney(report.grandTotal),
      ],
    ],
    theme: 'plain',
    styles: BODY_STYLES,
    headStyles: HEAD_STYLES,
    footStyles: FOOT_STYLES,
    columnStyles: COLUMN_STYLES,
    didParseCell: (data) => {
      if (data.section === 'body' && missingRows.has(data.row.index)) {
        data.cell.styles.fillColor = AMBER_FILL;
        data.cell.styles.textColor = AMBER_TEXT;
      }
    },
  });

  if (report.missingRateCount > 0) {
    let noteY = lastTableFinalY(doc, bandBottom + 18) + 22;
    if (noteY > pageHeight - MARGIN) {
      doc.addPage();
      noteY = MARGIN + 24;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(
      report.missingRateCount === 1
        ? 'Warning: 1 line has no pay rate on file and is paid at $0.'
        : `Warning: ${report.missingRateCount} lines have no pay rate on file and are paid at $0.`,
      MARGIN,
      noteY,
    );
    doc.setTextColor(0);
  }

  drawPageFooter(doc, pageWidth, pageHeight);
  doc.save(`payroll-master-${period.start}-to-${period.end}.pdf`);
}
