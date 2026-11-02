import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBookingPrice,
  calculateDiscount,
  calculateServiceLine,
} from "./booking-pricing.js";

const dates = {checkIn: "2027-04-01", checkOut: "2027-04-04"};
const supplements = {breakfastPrice: 5, petsPrice: 10};

test("uses standard single, double and extra-bed rates per night", () => {
  const single = calculateBookingPrice({
    ...dates, ...supplements, adults: 1, children: 0, breakfast: false, pets: false,
    singlePrice: 30, doublePrice: 45, extraBedPrice: 15,
  });
  const double = calculateBookingPrice({
    ...dates, ...supplements, adults: 2, children: 0, breakfast: false, pets: false,
    singlePrice: 30, doublePrice: 45, extraBedPrice: 15,
  });
  const triple = calculateBookingPrice({
    ...dates, ...supplements, adults: 2, children: 1, breakfast: false, pets: false,
    singlePrice: 30, doublePrice: 45, extraBedPrice: 15,
  });

  assert.equal(single.roomSubtotal, 90);
  assert.equal(double.roomSubtotal, 135);
  assert.equal(triple.roomSubtotal, 180);
});

test("uses the rural-house flat nightly rate and configurable supplements", () => {
  const result = calculateBookingPrice({
    ...dates, ...supplements, adults: 8, children: 5, breakfast: true, pets: true,
    pricingType: "rural_house", ruralHousePrice: 90,
  });

  assert.equal(result.roomSubtotal, 270);
  assert.equal(result.breakfastTotal, 195);
  assert.equal(result.petsTotal, 10);
  assert.equal(result.total, 475);
});

test("rounds percentage discounts to cents", () => {
  assert.equal(calculateDiscount(99.99, 15), 15);
});

test("prices service units using the right guest and stay quantities", () => {
  const context = {travelers: 3, nights: 2};
  assert.deepEqual(calculateServiceLine({
    price: 5,
    pricing_unit: "per_person_night",
  }, context), {quantity: 6, unit_price: 5, total: 30});
  assert.deepEqual(calculateServiceLine({
    price: 10,
    pricing_unit: "per_stay",
  }, context), {quantity: 1, unit_price: 10, total: 10});
  assert.deepEqual(calculateServiceLine({
    price: 8,
    pricing_unit: "per_night",
  }, context), {quantity: 2, unit_price: 8, total: 16});
  assert.deepEqual(calculateServiceLine({
    price: 2.5,
    pricing_unit: "per_unit",
  }, {...context, quantity: 4}), {quantity: 4, unit_price: 2.5, total: 10});
});

test("rejects invalid quantities for services charged per unit", () => {
  assert.throws(() => calculateServiceLine({
    price: 2,
    pricing_unit: "per_unit",
  }, {travelers: 2, nights: 1, quantity: 0}), RangeError);
});
