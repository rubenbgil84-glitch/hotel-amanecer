import assert from "node:assert/strict";
import test from "node:test";
import {createMailgunMailer} from "./mailgun-mailer.js";

test("sends Mailgun messages with recipients, reply-to, and attachments", async () => {
  let request;
  const mailer = createMailgunMailer({
    apiKey: "test-key",
    domain: "mg.example.com",
    apiBaseUrl: "https://api.eu.mailgun.net/",
    fetchImpl: async (url, options) => {
      request = {url, ...options};
      return new Response(JSON.stringify({id: "mailgun-id"}), {status: 200});
    },
  });

  const result = await mailer.sendMail({
    from: "Hotel <reservas@mg.example.com>",
    to: ["guest@example.com", "hotel@example.com"],
    replyTo: "reply@example.com",
    subject: "Reserva",
    text: "Confirmada",
    html: "<p>Confirmada</p>",
    attachments: [
      {
        filename: "reserva.pdf",
        content: Buffer.from("pdf"),
        contentType: "application/pdf",
      },
      {
        filename: "qr.png",
        content: Buffer.from("png"),
        contentType: "image/png",
        cid: "reservation-qr",
      },
    ],
  });

  assert.equal(
    request.url,
    "https://api.eu.mailgun.net/v3/mg.example.com/messages",
  );
  assert.equal(
    request.headers.Authorization,
    `Basic ${Buffer.from("api:test-key").toString("base64")}`,
  );
  assert.equal(request.body.get("from"), "Hotel <reservas@mg.example.com>");
  assert.deepEqual(request.body.getAll("to"), [
    "guest@example.com",
    "hotel@example.com",
  ]);
  assert.equal(request.body.get("h:Reply-To"), "reply@example.com");
  assert.equal(request.body.get("subject"), "Reserva");
  assert.equal(request.body.get("text"), "Confirmada");
  assert.equal(request.body.get("html"), "<p>Confirmada</p>");
  assert.equal(request.body.get("attachment").name, "reserva.pdf");
  assert.equal(request.body.get("inline").name, "reservation-qr");
  assert.deepEqual(result, {messageId: "mailgun-id"});
});

test("routes test messages only to the configured test recipient", async () => {
  let requestBody;
  const mailer = createMailgunMailer({
    apiKey: "test-key",
    domain: "mg.example.com",
    testRecipient: "owner@example.com",
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return new Response(JSON.stringify({id: "test-id"}), {status: 200});
    },
  });

  await mailer.sendMail({
    from: "reservas@mg.example.com",
    to: "guest@example.com",
    subject: "Prueba",
  });

  assert.deepEqual(requestBody.getAll("to"), ["owner@example.com"]);
});

test("reports Mailgun API errors", async () => {
  const mailer = createMailgunMailer({
    apiKey: "test-key",
    domain: "mg.example.com",
    fetchImpl: async () =>
      new Response(JSON.stringify({message: "Domain not verified"}), {
        status: 401,
      }),
  });

  await assert.rejects(
    mailer.sendMail({
      from: "reservas@mg.example.com",
      to: "guest@example.com",
      subject: "Reserva",
    }),
    /Mailgun API 401: Domain not verified/,
  );
});
