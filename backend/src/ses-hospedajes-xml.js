function dateOnly(value) {
  const date = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("La fecha del XML SES.Hospedajes no es válida.");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("La fecha del XML SES.Hospedajes no es válida.");
  }
  return date;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function madridOffset(date, time = "12:00") {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(`${date}T${time}:00Z`));
  const zone = formatted.find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone ?? "");
  if (!match) return "+00:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
}

function formatSesDate(value) {
  const date = dateOnly(value);
  return `${date}${madridOffset(date)}`;
}

function formatSesDateTime(dateValue, timeValue) {
  const date = dateOnly(dateValue);
  const time = String(timeValue ?? "").slice(0, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("La hora de entrada o salida no es válida.");
  }
  return `${date}T${time}:00.000${madridOffset(date, time)}`;
}

function formatContractDate(value) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type) => date.find((part) => part.type === type)?.value;
  const dateValue = `${get("year")}-${get("month")}-${get("day")}`;
  return `${dateValue}${madridOffset(dateValue)}`;
}

function personXml(person) {
  const address = [
    `<direccion>${xmlEscape(person.address)}</direccion>`,
    `<direccionComplementaria>${xmlEscape(person.address_complement)}</direccionComplementaria>`,
    person.country_code === "ESP"
      ? `<codigoMunicipio>${xmlEscape(person.municipality_code)}</codigoMunicipio>`
      : `<nombreMunicipio>${xmlEscape(person.municipality_name)}</nombreMunicipio>`,
    `<codigoPostal>${xmlEscape(person.postal_code)}</codigoPostal>`,
    `<pais>${xmlEscape(person.country_code)}</pais>`,
  ].join("");
  return `<persona>
        <rol>VI</rol>
        <nombre>${xmlEscape(person.first_name)}</nombre>
        <apellido1>${xmlEscape(person.first_surname)}</apellido1>
        <apellido2>${xmlEscape(person.second_surname)}</apellido2>
        <tipoDocumento>${xmlEscape(person.document_type)}</tipoDocumento>
        <numeroDocumento>${xmlEscape(person.document_number)}</numeroDocumento>
        <soporteDocumento>${xmlEscape(person.document_support)}</soporteDocumento>
        <fechaNacimiento>${formatSesDate(person.birth_date)}</fechaNacimiento>
        <nacionalidad>${xmlEscape(person.nationality_code)}</nacionalidad>
        <sexo>${xmlEscape(person.sex)}</sexo>
        <direccion>${address}</direccion>
        <telefono>${xmlEscape(person.phone)}</telefono>
        <telefono2>${xmlEscape(person.phone2)}</telefono2>
        <correo>${xmlEscape(person.email)}</correo>
        ${person.relationship ? `<parentesco>${xmlEscape(person.relationship)}</parentesco>` : ""}
      </persona>`;
}

export function buildSesHospedajesXml({
  establishmentCode,
  internetAvailable,
  reference,
  contractDate,
  checkIn,
  checkOut,
  checkInTime,
  checkOutTime,
  travelerCount,
  payment,
  travelers,
}) {
  const paymentXml = [
    `<tipoPago>${xmlEscape(payment.type)}</tipoPago>`,
    `<fechaPago>${formatSesDate(payment.date)}</fechaPago>`,
    `<medioPago>${xmlEscape(payment.medium)}</medioPago>`,
    `<titular>${xmlEscape(payment.holder)}</titular>`,
    payment.type === "TARJT"
      ? `<caducidadTarjeta>${xmlEscape(payment.cardExpiry)}</caducidadTarjeta>`
      : "",
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ns2:peticion xmlns:ns2="http://www.neg.hospedajes.mir.es/altaParteHospedaje">
  <solicitud>
    <codigoEstablecimiento>${xmlEscape(establishmentCode)}</codigoEstablecimiento>
    <comunicacion>
      <contrato>
        <referencia>${xmlEscape(reference)}</referencia>
        <fechaContrato>${formatContractDate(contractDate)}</fechaContrato>
        <fechaEntrada>${formatSesDateTime(checkIn, checkInTime)}</fechaEntrada>
        <fechaSalida>${formatSesDateTime(checkOut, checkOutTime)}</fechaSalida>
        <numPersonas>${travelerCount}</numPersonas>
        <numHabitaciones>1</numHabitaciones>
        <internet>${internetAvailable ? "true" : "false"}</internet>
        <pago>${paymentXml}</pago>
      </contrato>
      ${travelers.map(personXml).join("\n      ")}
    </comunicacion>
  </solicitud>
</ns2:peticion>`;
}
