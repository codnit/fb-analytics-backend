import crypto from "crypto";

export interface FacebookDataDeletionPayload {
  algorithm: string;
  user_id: string;
  issued_at?: number;
  expires?: number;
}

export class InvalidFacebookSignedRequestError extends Error {
  constructor(message = "Invalid Facebook signed request") {
    super(message);
    this.name = "InvalidFacebookSignedRequestError";
  }
}

const decodeBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
};

export const parseFacebookDataDeletionSignedRequest = (
  signedRequest: string,
  appSecret: string
): FacebookDataDeletionPayload => {
  if (!signedRequest || !appSecret) {
    throw new InvalidFacebookSignedRequestError();
  }

  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new InvalidFacebookSignedRequestError();
  }

  const [encodedSignature, encodedPayload] = parts;
  const suppliedSignature = decodeBase64Url(encodedSignature);
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new InvalidFacebookSignedRequestError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8"));
  } catch {
    throw new InvalidFacebookSignedRequestError();
  }

  const data = payload as Partial<FacebookDataDeletionPayload>;
  if (
    typeof data.algorithm !== "string" ||
    data.algorithm.toUpperCase() !== "HMAC-SHA256" ||
    typeof data.user_id !== "string" ||
    !data.user_id.trim()
  ) {
    throw new InvalidFacebookSignedRequestError();
  }

  return {
    algorithm: "HMAC-SHA256",
    user_id: data.user_id.trim(),
    ...(typeof data.issued_at === "number" ? { issued_at: data.issued_at } : {}),
    ...(typeof data.expires === "number" ? { expires: data.expires } : {}),
  };
};

export const hashFacebookDeletionIdentifier = (value: string, appSecret: string): string =>
  crypto.createHmac("sha256", appSecret).update(`facebook-data-deletion:${value}`).digest("hex");

