type Email = { from: string; to: string[]; subject: string; html: string; text: string; reply_to?: string };

export class ResendError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly retryAfterMs = 0) {
    super(code);
  }
}

export async function sendResendEmail(apiKey: string, email: Email, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(10000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const name = body && typeof body === "object" && "name" in body && typeof body.name === "string" && /^[a-z_]{1,64}$/.test(body.name)
      ? body.name : "http_" + response.status;
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429 ||
      (response.status === 409 && name === "concurrent_idempotent_requests");
    const retryAfter = response.headers.get("retry-after");
    const delay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    // Store only a bounded error code, never provider messages that may contain personal data.
    throw new ResendError("RESEND_" + name.toUpperCase(), retryable, Number.isFinite(delay) ? Math.max(0, delay) : 0);
  }
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !body.id)
    throw new ResendError("RESEND_INVALID_RESPONSE", true);
  return body.id;
}
