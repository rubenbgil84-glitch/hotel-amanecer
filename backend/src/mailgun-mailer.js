export function createMailgunMailer({
  apiKey,
  domain,
  apiBaseUrl = "https://api.mailgun.net",
  testRecipient,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("Falta configurar MAILGUN_API_KEY en el entorno del backend.");
  }
  if (!domain) {
    throw new Error("Falta configurar MAILGUN_DOMAIN en el entorno del backend.");
  }

  const apiUrl = new URL(apiBaseUrl);
  if (apiUrl.protocol !== "https:" || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) {
    throw new Error("MAILGUN_API_BASE_URL debe ser una URL HTTPS de Mailgun.");
  }
  const endpoint = new URL(
    `/v3/${encodeURIComponent(domain)}/messages`,
    apiUrl,
  ).toString();

  return {
    async sendMail(message) {
      if (!message.from) {
        throw new Error(
          "Falta configurar EMAIL_FROM con una dirección verificada en Mailgun.",
        );
      }

      const recipients = testRecipient
        ? [testRecipient]
        : Array.isArray(message.to)
          ? message.to
          : [message.to];
      const form = new FormData();
      form.append("from", message.from);
      for (const recipient of recipients) form.append("to", recipient);
      form.append("subject", message.subject);
      if (message.replyTo) form.append("h:Reply-To", message.replyTo);
      if (message.text) form.append("text", message.text);
      if (message.html) form.append("html", message.html);

      for (const attachment of message.attachments ?? []) {
        const content = Buffer.isBuffer(attachment.content)
          ? attachment.content
          : Buffer.from(attachment.content);
        const blob = new Blob([new Uint8Array(content)], {
          type: attachment.contentType || "application/octet-stream",
        });
        form.append(
          attachment.cid ? "inline" : "attachment",
          blob,
          attachment.cid || attachment.filename,
        );
      }

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        },
        body: form,
      });
      const responseText = await response.text();
      let result;
      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        result = {};
      }
      if (!response.ok) {
        throw new Error(
          `Mailgun API ${response.status}: ${result.message || responseText || "error al enviar correo"}`,
        );
      }
      return {messageId: result.id};
    },
  };
}
