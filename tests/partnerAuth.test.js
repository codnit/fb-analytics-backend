process.env.JWT_SECRET = "partner-auth-test-secret";

const jwt = require("jsonwebtoken");
const mockFindUnique = jest.fn();

jest.mock("../src/config/database", () => ({
  getDB: () => ({
    partner: { findUnique: mockFindUnique },
  }),
}));

const { partnerAuth } = require("../src/middleware/partnerAuth");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const createPartnerRequest = () => ({
  headers: {
    authorization: `Bearer ${jwt.sign(
      { id: "partner-123", role: "partner" },
      process.env.JWT_SECRET
    )}`,
  },
});

describe("partnerAuth account deletion enforcement", () => {
  beforeEach(() => mockFindUnique.mockReset());

  test("rejects a valid JWT after its Partner row was hard-deleted", async () => {
    mockFindUnique.mockResolvedValue(null);
    const request = createPartnerRequest();
    const response = createResponse();
    const next = jest.fn();

    await partnerAuth(request, response, next);

    expect(response.statusCode).toBe(401);
    expect(response.body.code).toBe("PARTNER_ACCOUNT_DELETED");
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects a Partner while hard deletion is in progress", async () => {
    mockFindUnique.mockResolvedValue({
      id: "partner-123",
      facebook_data_deleted_at: new Date(),
    });
    const request = createPartnerRequest();
    const response = createResponse();
    const next = jest.fn();

    await partnerAuth(request, response, next);

    expect(response.statusCode).toBe(401);
    expect(response.body.code).toBe("PARTNER_ACCOUNT_DELETED");
    expect(next).not.toHaveBeenCalled();
  });

  test("allows an existing active Partner", async () => {
    mockFindUnique.mockResolvedValue({
      id: "partner-123",
      facebook_data_deleted_at: null,
    });
    const request = createPartnerRequest();
    const response = createResponse();
    const next = jest.fn();

    await partnerAuth(request, response, next);

    expect(request.partnerId).toBe("partner-123");
    expect(next).toHaveBeenCalledTimes(1);
  });
});

