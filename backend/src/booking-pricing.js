export function calculateBookingPrice({
  pricingType = "standard",
  singlePrice,
  doublePrice,
  extraBedPrice,
  ruralHousePrice,
  pricePerNight,
  checkIn,
  checkOut,
  adults,
  children,
  breakfast,
  pets,
  breakfastPrice,
  petsPrice,
}) {
  const nights = Math.round(
    (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000,
  );
  const travelers = adults + children;
  const nightlyRoomPrice = pricingType === "rural_house"
    ? Number(ruralHousePrice ?? pricePerNight)
    : travelers === 1
      ? Number(singlePrice ?? pricePerNight)
      : Number(doublePrice ?? pricePerNight) +
        Math.max(0, travelers - 2) * Number(extraBedPrice ?? 0);
  const roomSubtotal = nights * nightlyRoomPrice;
  const breakfastTotal = breakfast
    ? Number(breakfastPrice) * travelers * nights
    : 0;
  const petsTotal = pets ? Number(petsPrice) : 0;
  return {
    nights,
    nightlyRoomPrice,
    roomSubtotal,
    breakfastTotal,
    petsTotal,
    total: roomSubtotal + breakfastTotal + petsTotal,
  };
}

export function calculateDiscount(amount, percent) {
  return Math.round((amount * percent) / 100 * 100) / 100;
}
