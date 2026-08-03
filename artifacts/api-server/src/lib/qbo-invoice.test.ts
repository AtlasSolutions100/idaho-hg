import { describe, it, expect } from "vitest";
import { buildQboInvoicePayload } from "./qbo-invoice";
import type { InvoiceLine } from "./invoice-lines";

const customerRef = { value: "42", name: "St. Luke's" };

function line(overrides: Partial<InvoiceLine>): InvoiceLine {
  return {
    lineId: "1",
    date: "2026-07-25",
    productService: "Clark, Molly RN",
    description: "MC SNV 7/12-7/25/26",
    qty: 4,
    rate: 55,
    amount: 220,
    kind: "visit",
    missingRate: false,
    ...overrides,
  };
}

describe("buildQboInvoicePayload", () => {
  it("mirrors lines exactly: order, qty, rate, amount, service date", () => {
    const lines = [
      line({ lineId: "1" }),
      line({
        lineId: "2",
        date: "2026-07-13",
        description: "MC mileage 7/12-7/13/26",
        qty: 34.5,
        rate: 0.655,
        amount: 22.6,
        kind: "mileage",
      }),
    ];
    const itemRefsByName = new Map([["Clark, Molly RN", { value: "7", name: "Clark, Molly RN" }]]);
    const payload = buildQboInvoicePayload({
      customerRef,
      lines,
      itemRefsByName,
      txnDate: "2026-07-25",
      periodStart: "2026-07-12",
      periodEnd: "2026-07-25",
    });

    expect(payload.CustomerRef).toEqual(customerRef);
    expect(payload.TxnDate).toBe("2026-07-25");
    expect(payload.Line).toHaveLength(2);
    expect(payload.Line[0]).toMatchObject({
      LineNum: 1,
      DetailType: "SalesItemLineDetail",
      Amount: 220,
      Description: "MC SNV 7/12-7/25/26",
      SalesItemLineDetail: {
        ItemRef: { value: "7", name: "Clark, Molly RN" },
        Qty: 4,
        UnitPrice: 55,
        ServiceDate: "2026-07-25",
      },
    });
    expect(payload.Line[1]).toMatchObject({
      LineNum: 2,
      Amount: 22.6,
      SalesItemLineDetail: { Qty: 34.5, UnitPrice: 0.655, ServiceDate: "2026-07-13" },
    });
  });

  it("keeps the no-rate warning visible and bills $0, like the CSV", () => {
    const itemRefsByName = new Map([["Clark, Molly RN", { value: "7" }]]);
    const payload = buildQboInvoicePayload({
      customerRef,
      lines: [line({ rate: undefined, amount: 0, missingRate: true })],
      itemRefsByName,
      txnDate: "2026-07-25",
      periodStart: "2026-07-12",
      periodEnd: "2026-07-25",
    });
    expect(payload.Line[0]).toMatchObject({
      Amount: 0,
      Description: "MC SNV 7/12-7/25/26 — NO RATE ON FILE",
      SalesItemLineDetail: { UnitPrice: 0 },
    });
  });

  it("throws (instead of silently dropping a line) when an item mapping is missing", () => {
    expect(() =>
      buildQboInvoicePayload({
        customerRef,
        lines: [line({})],
        itemRefsByName: new Map(),
        txnDate: "2026-07-25",
        periodStart: "2026-07-12",
        periodEnd: "2026-07-25",
      }),
    ).toThrow(/Clark, Molly RN/);
  });

  it("notes the billing period on the invoice", () => {
    const payload = buildQboInvoicePayload({
      customerRef,
      lines: [line({})],
      itemRefsByName: new Map([["Clark, Molly RN", { value: "7" }]]),
      txnDate: "2026-07-25",
      periodStart: "2026-07-12",
      periodEnd: "2026-07-25",
    });
    expect(payload.PrivateNote).toContain("2026-07-12");
    expect(payload.PrivateNote).toContain("2026-07-25");
  });
});
