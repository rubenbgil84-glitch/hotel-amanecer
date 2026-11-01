import assert from "node:assert/strict";
import test from "node:test";
import {buildSesHospedajesXml} from "./ses-hospedajes-xml.js";

const traveler = {
  first_name: "Ana & María",
  first_surname: "Pérez",
  second_surname: "",
  document_type: "NIF",
  document_number: "12345678Z",
  document_support: "ABC123",
  birth_date: "1990-04-15",
  nationality_code: "ESP",
  sex: "M",
  address: "Calle <Mayor>",
  address_complement: "",
  municipality_code: "34001",
  municipality_name: "Palencia",
  postal_code: "34001",
  country_code: "ESP",
  phone: "+34979000000",
  phone2: "",
  email: "ana@example.com",
  relationship: "",
};

const makeXml = (paymentType = "TARJT") => buildSesHospedajesXml({
  establishmentCode: "EST-123",
  internetAvailable: true,
  reference: "HA-2026-001",
  contractDate: "2026-11-01T10:00:00.000Z",
  checkIn: "2026-11-10",
  checkOut: "2026-11-12",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  travelerCount: 1,
  payment: {
    type: paymentType,
    date: "2026-11-01",
    medium: "Terminal",
    holder: "Ana Pérez",
    cardExpiry: "12/2027",
  },
  travelers: [traveler],
});

test("generates the SES lodging request with escaped content and Spain time offsets", () => {
  const xml = makeXml();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /xmlns:ns2="http:\/\/www\.neg\.hospedajes\.mir\.es\/altaParteHospedaje"/);
  assert.match(xml, /<codigoEstablecimiento>EST-123<\/codigoEstablecimiento>/);
  assert.match(xml, /<fechaEntrada>2026-11-10T15:00:00\.000\+01:00<\/fechaEntrada>/);
  assert.match(xml, /<fechaSalida>2026-11-12T11:00:00\.000\+01:00<\/fechaSalida>/);
  assert.match(xml, /<nombre>Ana &amp; María<\/nombre>/);
  assert.match(xml, /<direccion>Calle &lt;Mayor&gt;<\/direccion>/);
  assert.match(xml, /<codigoMunicipio>34001<\/codigoMunicipio>/);
  assert.match(xml, /<caducidadTarjeta>12\/2027<\/caducidadTarjeta>/);
  assert.equal((xml.match(/<persona>/g) ?? []).length, 1);
});

test("omits card expiry for non-card payment methods", () => {
  assert.doesNotMatch(makeXml("EFECT"), /<caducidadTarjeta>/);
});
