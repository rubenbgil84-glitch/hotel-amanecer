import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateVatBreakdown,
  normalizeLegacyVatAmounts,
} from "./booking-vat.js";

test("extracts included VAT for a stay at one rate", () => {
  const breakdown = calculateVatBreakdown({
    checkIn: "2026-11-28",
    checkOut: "2026-12-01",
    roomSubtotal: 300,
    breakfastTotal: 0,
    petsTotal: 0,
    rates: [{effective_from: "1900-01-01", rate: 10}],
  });
  assert.deepEqual(breakdown, [{
    effective_from: "1900-01-01",
    rate: 10,
    gross: 300,
    discount: 0,
    taxable_base: 272.73,
    vat: 27.27,
    total: 300,
  }]);
});

test("applies scheduled rates per night and allocates a discount proportionally", () => {
  const breakdown = calculateVatBreakdown({
    checkIn: "2026-11-30",
    checkOut: "2026-12-03",
    roomSubtotal: 300,
    breakfastTotal: 0,
    petsTotal: 0,
    discountAmount: 30,
    rates: [
      {effective_from: "1900-01-01", rate: 10},
      {effective_from: "2026-12-01", rate: 11},
    ],
  });
  assert.equal(breakdown.length, 2);
  assert.deepEqual(breakdown.map(({rate, gross, discount, total}) => ({rate, gross, discount, total})), [
    {rate: 10, gross: 100, discount: 10, total: 90},
    {rate: 11, gross: 200, discount: 20, total: 180},
  ]);
  assert.equal(breakdown.reduce((sum, item) => sum + item.vat, 0), 26.02);
  assert.equal(breakdown.reduce((sum, item) => sum + item.taxable_base, 0), 243.98);
});

test("allocates rounded supplementary amounts without changing the total", () => {
  const breakdown = calculateVatBreakdown({
    checkIn: "2027-01-01",
    checkOut: "2027-01-04",
    roomSubtotal: 90,
    breakfastTotal: 45.01,
    petsTotal: 10,
    discountAmount: 1.01,
    rates: [{effective_from: "1900-01-01", rate: 10}],
  });
  assert.equal(breakdown[0].gross, 145.01);
  assert.equal(breakdown[0].discount, 1.01);
  assert.equal(breakdown[0].total, 144);
  assert.equal(breakdown[0].taxable_base + breakdown[0].vat, breakdown[0].total);
});

test("rejects impossible stay dates", () => {
  assert.throws(() => calculateVatBreakdown({
    checkIn: "2026-02-30",
    checkOut: "2026-03-02",
    roomSubtotal: 100,
    breakfastTotal: 0,
    petsTotal: 0,
    rates: [{effective_from: "1900-01-01", rate: 10}],
  }), RangeError);
});

test("repairs inconsistent historical line items while preserving their total", () => {
  const {pricing, discountAmount} = normalizeLegacyVatAmounts({
    total: "214.00",
    roomSubtotal: "-141.00",
    breakfastTotal: "345.00",
    petsTotal: "10.00",
    discountAmount: "0.00",
  });
  assert.equal(pricing.roomSubtotal, 0);
  assert.equal(
    Math.round(
      (pricing.roomSubtotal + pricing.breakfastTotal + pricing.petsTotal) * 100,
    ),
    21400,
  );
  assert.equal(discountAmount, 0);
  assert.doesNotThrow(() => calculateVatBreakdown({
    checkIn: "2026-11-01",
    checkOut: "2026-11-02",
    ...pricing,
    discountAmount,
    rates: [{effective_from: "1900-01-01", rate: 10}],
  }));
});
