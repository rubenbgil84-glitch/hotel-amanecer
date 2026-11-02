function toCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("El importe para calcular el IVA no es válido.");
  }
  return Math.round(amount * 100);
}

function distributeCents(totalCents, count) {
  if (!count) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({length: count}, (_, index) => base + (index < remainder ? 1 : 0));
}

function allocateProportionally(totalCents, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!totalCents || !totalWeight) return weights.map(() => 0);
  const shares = weights.map((weight, index) => {
    const exact = (totalCents * weight) / totalWeight;
    return {index, cents: Math.floor(exact), fraction: exact - Math.floor(exact)};
  });
  let remainder = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (!remainder) break;
    share.cents += 1;
    remainder -= 1;
  }
  return shares.sort((a, b) => a.index - b.index).map((share) => share.cents);
}

function getEffectiveRate(rates, category, date) {
  return rates.reduce(
    (selected, item) =>
      item.vat_category === category && item.effective_from <= date
        ? item
        : selected,
    null,
  );
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calculateCategorizedVatBreakdown({
  checkIn,
  checkOut,
  components,
  discountAmount = 0,
  rates,
}) {
  if (
    typeof checkIn !== "string" ||
    typeof checkOut !== "string" ||
    !isDateOnly(checkIn) ||
    !isDateOnly(checkOut) ||
    checkOut <= checkIn ||
    !Array.isArray(components) ||
    !Array.isArray(rates) ||
    rates.length === 0
  ) {
    throw new RangeError("No se pueden calcular los tipos de IVA para estas fechas.");
  }
  const start = Date.parse(`${checkIn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOut}T00:00:00.000Z`);
  const nights = Math.round((end - start) / 86_400_000);
  if (!Number.isInteger(nights) || nights < 1) {
    throw new RangeError("La estancia debe incluir al menos una noche para calcular el IVA.");
  }
  const normalizedRates = rates
    .map((rate) => ({
      effective_from: String(rate.effective_from).slice(0, 10),
      rate: Number(rate.rate),
      vat_category: String(rate.vat_category ?? "lodging"),
    }))
    .filter((rate) =>
      isDateOnly(rate.effective_from) &&
      Number.isFinite(rate.rate) &&
      rate.rate >= 0 &&
      rate.rate <= 100 &&
      rate.vat_category.length > 0,
    )
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  const nightlyByCategory = Array.from({length: nights}, () => new Map());
  for (const component of components) {
    const category = String(component.vat_category ?? "lodging");
    const nightlyAmounts = distributeCents(toCents(component.amount), nights);
    nightlyAmounts.forEach((amount, index) => {
      nightlyByCategory[index].set(
        category,
        (nightlyByCategory[index].get(category) ?? 0) + amount,
      );
    });
  }
  const nightlyGross = nightlyByCategory.map((categories) =>
    [...categories.values()].reduce((sum, amount) => sum + amount, 0),
  );
  const discountCents = toCents(discountAmount);
  const grossCents = nightlyGross.reduce((sum, amount) => sum + amount, 0);
  if (discountCents > grossCents) {
    throw new RangeError("El descuento no puede superar el importe de la estancia.");
  }
  const nightlyDiscount = allocateProportionally(discountCents, nightlyGross);
  const grouped = new Map();

  for (let index = 0; index < nights; index += 1) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const categories = [...nightlyByCategory[index]];
    const categoryDiscounts = allocateProportionally(
      nightlyDiscount[index],
      categories.map(([, amount]) => amount),
    );
    for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
      const [vatCategory, gross] = categories[categoryIndex];
      const effectiveRate = getEffectiveRate(normalizedRates, vatCategory, date);
      if (!effectiveRate) {
        throw new RangeError(
          `No hay un tipo de IVA configurado para la categoría ${vatCategory} en la noche del ${date}.`,
        );
      }
      const discount = categoryDiscounts[categoryIndex];
      const amountAfterDiscount = gross - discount;
      const taxableBase = Math.round(
        amountAfterDiscount / (1 + effectiveRate.rate / 100),
      );
      const key = `${vatCategory}:${effectiveRate.effective_from}:${effectiveRate.rate}`;
      const current = grouped.get(key) ?? {
        vat_category: vatCategory,
        effective_from: effectiveRate.effective_from,
        rate: effectiveRate.rate,
        gross_cents: 0,
        discount_cents: 0,
        taxable_base_cents: 0,
        vat_cents: 0,
      };
      current.gross_cents += gross;
      current.discount_cents += discount;
      current.taxable_base_cents += taxableBase;
      current.vat_cents += amountAfterDiscount - taxableBase;
      grouped.set(key, current);
    }
  }

  return [...grouped.values()].map((item) => ({
    vat_category: item.vat_category,
    effective_from: item.effective_from,
    rate: item.rate,
    gross: item.gross_cents / 100,
    discount: item.discount_cents / 100,
    taxable_base: item.taxable_base_cents / 100,
    vat: item.vat_cents / 100,
    total: (item.gross_cents - item.discount_cents) / 100,
  }));
}

export function normalizeLegacyVatAmounts({
  total,
  roomSubtotal,
  breakfastTotal,
  petsTotal,
  discountAmount,
}) {
  const nonNegativeAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const discount = nonNegativeAmount(discountAmount);
  const gross = nonNegativeAmount(total) + discount;
  const components = [
    nonNegativeAmount(roomSubtotal),
    nonNegativeAmount(breakfastTotal),
    nonNegativeAmount(petsTotal),
  ];
  const componentSum = components.reduce((sum, amount) => sum + amount, 0);
  if (gross === 0) {
    return {
      pricing: {roomSubtotal: 0, breakfastTotal: 0, petsTotal: 0},
      discountAmount: 0,
    };
  }
  if (componentSum === 0) {
    components[0] = gross;
  } else if (componentSum > gross) {
    const scale = gross / componentSum;
    for (let index = 0; index < components.length; index += 1) {
      components[index] *= scale;
    }
  } else {
    components[0] += gross - componentSum;
  }
  return {
    pricing: {
      roomSubtotal: components[0],
      breakfastTotal: components[1],
      petsTotal: components[2],
    },
    discountAmount: Math.min(discount, gross),
  };
}

export function calculateVatBreakdown({
  checkIn,
  checkOut,
  roomSubtotal,
  breakfastTotal,
  petsTotal,
  discountAmount = 0,
  rates,
}) {
  if (
    typeof checkIn !== "string" ||
    typeof checkOut !== "string" ||
    !isDateOnly(checkIn) ||
    !isDateOnly(checkOut) ||
    checkOut <= checkIn ||
    !Array.isArray(rates) ||
    rates.length === 0
  ) {
    throw new RangeError("No se pueden calcular los tipos de IVA para estas fechas.");
  }
  const start = Date.parse(`${checkIn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOut}T00:00:00.000Z`);
  const nights = Math.round((end - start) / 86_400_000);
  if (!Number.isInteger(nights) || nights < 1) {
    throw new RangeError("La estancia debe incluir al menos una noche para calcular el IVA.");
  }

  const normalizedRates = rates
    .map((rate) => ({
      effective_from: String(rate.effective_from).slice(0, 10),
      rate: Number(rate.rate),
    }))
    .filter((rate) =>
      isDateOnly(rate.effective_from) &&
      Number.isFinite(rate.rate) &&
      rate.rate >= 0 &&
      rate.rate <= 100,
    )
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const roomCents = distributeCents(toCents(roomSubtotal), nights);
  const breakfastCents = distributeCents(toCents(breakfastTotal), nights);
  const petsCents = distributeCents(toCents(petsTotal), nights);
  const nightlyGross = roomCents.map((room, index) =>
    room + breakfastCents[index] + petsCents[index],
  );
  const discountCents = toCents(discountAmount);
  const grossCents = nightlyGross.reduce((sum, value) => sum + value, 0);
  if (discountCents > grossCents) {
    throw new RangeError("El descuento no puede superar el importe de la estancia.");
  }
  const nightlyDiscount = allocateProportionally(discountCents, nightlyGross);
  const grouped = new Map();

  for (let index = 0; index < nights; index += 1) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const effectiveRate = normalizedRates.reduce(
      (selected, item) => item.effective_from <= date ? item : selected,
      null,
    );
    if (!effectiveRate) {
      throw new RangeError(`No hay un tipo de IVA configurado para la noche del ${date}.`);
    }
    const amountAfterDiscount = nightlyGross[index] - nightlyDiscount[index];
    const taxableBase = Math.round(amountAfterDiscount / (1 + effectiveRate.rate / 100));
    const vat = amountAfterDiscount - taxableBase;
    const key = `${effectiveRate.effective_from}:${effectiveRate.rate}`;
    const current = grouped.get(key) ?? {
      effective_from: effectiveRate.effective_from,
      rate: effectiveRate.rate,
      gross_cents: 0,
      discount_cents: 0,
      taxable_base_cents: 0,
      vat_cents: 0,
    };
    current.gross_cents += nightlyGross[index];
    current.discount_cents += nightlyDiscount[index];
    current.taxable_base_cents += taxableBase;
    current.vat_cents += vat;
    grouped.set(key, current);
  }

  return [...grouped.values()].map((item) => ({
    effective_from: item.effective_from,
    rate: item.rate,
    gross: item.gross_cents / 100,
    discount: item.discount_cents / 100,
    taxable_base: item.taxable_base_cents / 100,
    vat: item.vat_cents / 100,
    total: (item.gross_cents - item.discount_cents) / 100,
  }));
}
