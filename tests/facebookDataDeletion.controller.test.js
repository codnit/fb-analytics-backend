const crypto = require("crypto");
const facebookDataDeletionService = require("../src/services/facebook/data-deletion.service").default;
const facebookDataDeletionController = require("../src/controllers/facebookDataDeletion.controller").default;

const createSignedRequest = (payload, secret) => {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${signature}.${encodedPayload}`;
};

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    type() {
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  return response;
};

describe("Facebook data deletion controller", () => {
  const originalAppSecret = process.env.FB_APP_SECRET;
  const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;
  const secret = "controller-test-app-secret";

  beforeEach(() => {
    process.env.FB_APP_SECRET = secret;
    process.env.PUBLIC_API_BASE_URL = "http://localhost:5000/api/v1";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAppSecret === undefined) delete process.env.FB_APP_SECRET;
    else process.env.FB_APP_SECRET = originalAppSecret;
    if (originalPublicApiBaseUrl === undefined) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
  });

  test("returns Meta's required URL and confirmation_code response", async () => {
    jest.spyOn(facebookDataDeletionService, "deleteFacebookDataForUser").mockResolvedValue({
      confirmationCode: "a".repeat(32),
      status: "completed",
      statusMessage: "Completed",
    });

    const signedRequest = createSignedRequest({
      algorithm: "HMAC-SHA256",
      user_id: "app-scoped-user-123",
    }, secret);
    const request = {
      body: { signed_request: signedRequest },
      protocol: "http",
      get: () => "localhost:5000",
    };
    const response = createResponse();

    await facebookDataDeletionController.callback(request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      url: `http://localhost:5000/api/v1/facebook/data-deletion/status/${"a".repeat(32)}`,
      confirmation_code: "a".repeat(32),
    });
    expect(facebookDataDeletionService.deleteFacebookDataForUser)
      .toHaveBeenCalledWith("app-scoped-user-123", secret);
  });

  test("rejects an invalid signature without deleting data", async () => {
    const deletionSpy = jest.spyOn(facebookDataDeletionService, "deleteFacebookDataForUser");
    const request = {
      body: { signed_request: "invalid.request" },
      protocol: "http",
      get: () => "localhost:5000",
    };
    const response = createResponse();

    await facebookDataDeletionController.callback(request, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Invalid signed_request" });
    expect(deletionSpy).not.toHaveBeenCalled();
  });
});
