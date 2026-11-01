import test from "node:test";
import assert from "node:assert/strict";
import {calculateBookingPrice, calculateDiscount} from "./booking-pricing.js";

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
