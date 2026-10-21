import { isBookId } from "./catalog";
export class InputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new InputError("Les fichiers sont trop volumineux.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Formulaire vide.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new InputError("Les fichiers sont trop volumineux.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
function value(data: FormData, name: string, max: number, required = true) {
  const raw = data.get(name);
  if (raw !== null && typeof raw !== "string")
    throw new InputError("Champ invalide.");
  const text = (raw || "").trim();
  if (
    (required && !text) ||
    text.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  )
    throw new InputError(`Vérifiez le champ « ${name} ».`);
  return text;
}
export function validateOrder(data: FormData) {
  const book = value(data, "book", 20);
  if (!isBookId(book)) throw new InputError("Choisissez une aventure.");
  const attemptId = value(data, "attemptId", 36);
  if (
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      attemptId,
    )
  )
    throw new InputError("Veuillez recharger le formulaire.");
  const email = value(data, "email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InputError("Vérifiez votre adresse e-mail.");
  const postalCode = value(data, "postalCode", 5);
  if (!/^\d{5}$/.test(postalCode) || /^(97|98)/.test(postalCode))
    throw new InputError("Indiquez un code postal de France métropolitaine.");
  if (data.get("country") !== "FR")
    throw new InputError(
      "La livraison est disponible en France métropolitaine.",
    );
  if (data.get("photoConsent") !== "on" || data.get("termsConsent") !== "on")
    throw new InputError("Votre accord est nécessaire pour préparer ce livre.");
  return {
    attemptId,
    book,
    email,
    postalCode,
    childName: value(data, "childName", 60),
    firstName: value(data, "firstName", 80),
    lastName: value(data, "lastName", 80),
    address: value(data, "address", 150),
    addressExtra: value(data, "addressExtra", 150, false),
    city: value(data, "city", 100),
    notes: value(data, "notes", 500, false),
  };
}
export async function validatePhoto(
  entry: FormDataEntryValue | null,
  required: boolean,
) {
  if (!(entry instanceof File) || entry.size === 0) {
    if (required) throw new InputError("Ajoutez une photo de la tétine.");
    return null;
  }
  if (entry.size > 5 * 1024 * 1024)
    throw new InputError("Chaque photo doit faire moins de 5 Mo.", 413);
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10;
  const webp =
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  const mime = jpeg
    ? "image/jpeg"
    : png
      ? "image/png"
      : webp
        ? "image/webp"
        : null;
  if (!mime || entry.type !== mime)
    throw new InputError("Choisissez une vraie image JPG, PNG ou WebP.");
  return { bytes, mime };
}
export async function sha256(data: Uint8Array | string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
