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

export function calculateServiceLine(service, {travelers, nights, quantity = 1}) {
  const price = Number(service.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new RangeError("El precio del servicio no es válido.");
  }
  if (!Number.isInteger(travelers) || travelers < 1 || !Number.isInteger(nights) || nights < 1) {
    throw new RangeError("La ocupación o las noches no son válidas para calcular el servicio.");
  }
  let chargedQuantity;
  switch (service.pricing_unit) {
    case "per_person_night":
      chargedQuantity = travelers * nights;
      break;
    case "per_stay":
      chargedQuantity = 1;
      break;
    case "per_night":
      chargedQuantity = nights;
      break;
    case "per_unit":
      chargedQuantity = quantity;
      if (!Number.isInteger(chargedQuantity) || chargedQuantity < 1 || chargedQuantity > 100) {
        throw new RangeError("Indica una cantidad válida para el servicio.");
      }
      break;
    default:
      throw new RangeError("La unidad de cobro del servicio no es válida.");
  }
  return {
    quantity: chargedQuantity,
    unit_price: price,
    total: Math.round(price * chargedQuantity * 100) / 100,
  };
}
