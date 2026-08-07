const crypto = require("crypto");
const {
  InvalidFacebookSignedRequestError,
  parseFacebookDataDeletionSignedRequest,
} = require("../src/utils/facebookDataDeletion");

const toBase64Url = (value) => Buffer.from(value).toString("base64url");

const createSignedRequest = (payload, secret) => {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${signature}.${encodedPayload}`;
};

describe("Facebook data deletion signed_request verification", () => {
  const secret = "test-app-secret";

  test("accepts a valid HMAC-SHA256 request", () => {
    const signedRequest = createSignedRequest(
      { algorithm: "HMAC-SHA256", user_id: "app-scoped-user-123", issued_at: 123456 },
      secret
    );

    expect(parseFacebookDataDeletionSignedRequest(signedRequest, secret)).toEqual({
      algorithm: "HMAC-SHA256",
      user_id: "app-scoped-user-123",
      issued_at: 123456,
    });
  });

  test("rejects a request whose payload was modified", () => {
    const signedRequest = createSignedRequest(
      { algorithm: "HMAC-SHA256", user_id: "original-user" },
      secret
    );
    const [signature] = signedRequest.split(".");
    const changedPayload = toBase64Url(JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "different-user",
    }));

    expect(() => parseFacebookDataDeletionSignedRequest(
      `${signature}.${changedPayload}`,
      secret
    )).toThrow(InvalidFacebookSignedRequestError);
  });

  test("rejects unsupported algorithms", () => {
    const signedRequest = createSignedRequest(
      { algorithm: "none", user_id: "app-scoped-user-123" },
      secret
    );

    expect(() => parseFacebookDataDeletionSignedRequest(signedRequest, secret))
      .toThrow(InvalidFacebookSignedRequestError);
  });

  test("rejects a missing user identifier", () => {
    const signedRequest = createSignedRequest({ algorithm: "HMAC-SHA256" }, secret);

    expect(() => parseFacebookDataDeletionSignedRequest(signedRequest, secret))
      .toThrow(InvalidFacebookSignedRequestError);
  });
});

