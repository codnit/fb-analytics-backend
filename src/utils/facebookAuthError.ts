import axios from "axios";

export const FACEBOOK_REAUTH_REQUIRED = "FACEBOOK_REAUTH_REQUIRED";

const TOKEN_ERROR_CODES = new Set([102, 190]);
const TOKEN_ERROR_PATTERN =
  /(error validating access token|invalid oauth access token|oauthexception|oauth(?:access)?tokenexception|session has (?:been invalidated|expired)|access token (?:has )?expired)/i;

const getFacebookErrorPayload = (error: unknown): Record<string, unknown> | null => {
  if (!axios.isAxiosError(error)) {
    return null;
  }

  const responseData = error.response?.data as
    | { error?: Record<string, unknown> }
    | undefined;
  return responseData?.error || null;
};

export const isFacebookTokenError = (error: unknown): boolean => {
  const payload = getFacebookErrorPayload(error);
  const code = Number(payload?.code);

  if (TOKEN_ERROR_CODES.has(code)) {
    return true;
  }

  const message = [
    payload?.message,
    error instanceof Error ? error.message : error,
  ]
    .filter(Boolean)
    .join(" ");

  return TOKEN_ERROR_PATTERN.test(message);
};
