import type { Request, Response } from "express";
import { Environment } from "../config/environment";
import facebookDataDeletionService from "../services/facebook/data-deletion.service";
import {
  InvalidFacebookSignedRequestError,
  parseFacebookDataDeletionSignedRequest,
} from "../utils/facebookDataDeletion";

const CONFIRMATION_CODE_PATTERN = /^[a-f0-9]{32}$/i;

const getStatusUrlBase = (req: Request): string => {
  const configuredBaseUrl = Environment.publicApiBaseUrl;
  const requestHost = req.get("host");

  if (!configuredBaseUrl && !requestHost) {
    throw new Error("Unable to determine the public API URL");
  }

  const baseUrl = configuredBaseUrl || `${req.protocol}://${requestHost}${Environment.apiPrefix}`;
  const parsedBaseUrl = new URL(baseUrl);

  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    throw new Error("PUBLIC_API_BASE_URL must use HTTP or HTTPS");
  }

  if (Environment.nodeEnv === "production" && parsedBaseUrl.protocol !== "https:") {
    throw new Error("PUBLIC_API_BASE_URL must use HTTPS in production");
  }

  return `${baseUrl}/facebook/data-deletion/status`;
};

export class FacebookDataDeletionController {
  callback = async (req: Request, res: Response): Promise<Response> => {
    const appSecret = Environment.fbAppSecret;
    if (!appSecret) {
      return res.status(503).json({ error: "Facebook data deletion is not configured" });
    }

    try {
      const signedRequest = typeof req.body?.signed_request === "string"
        ? req.body.signed_request
        : "";
      const payload = parseFacebookDataDeletionSignedRequest(signedRequest, appSecret);
      const statusUrlBase = getStatusUrlBase(req);
      const result = await facebookDataDeletionService.deleteFacebookDataForUser(
        payload.user_id,
        appSecret
      );

      return res.status(200).json({
        url: `${statusUrlBase}/${encodeURIComponent(result.confirmationCode)}`,
        confirmation_code: result.confirmationCode,
      });
    } catch (error) {
      if (error instanceof InvalidFacebookSignedRequestError) {
        return res.status(400).json({ error: "Invalid signed_request" });
      }

      console.error("Facebook data deletion callback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Unable to process data deletion request" });
    }
  };

  status = async (req: Request, res: Response): Promise<Response> => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    try {
      const confirmationCode = req.params.confirmationCode;
      if (!CONFIRMATION_CODE_PATTERN.test(confirmationCode)) {
        return res.status(404).type("html").send(this.renderStatusPage(
          "Request not found",
          "This Facebook data deletion confirmation code is not valid."
        ));
      }

      const result = await facebookDataDeletionService.getStatus(confirmationCode);
      if (!result) {
        return res.status(404).type("html").send(this.renderStatusPage(
          "Request not found",
          "No Facebook data deletion request was found for this confirmation code."
        ));
      }

      const heading = result.status === "completed"
        ? "Facebook data deletion completed"
        : "Facebook data deletion in progress";

      return res.status(200).type("html").send(this.renderStatusPage(
        heading,
        result.statusMessage,
        result.confirmationCode
      ));
    } catch (error) {
      console.error("Facebook data deletion status lookup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).type("html").send(this.renderStatusPage(
        "Status temporarily unavailable",
        "Please try checking this Facebook data deletion request again later."
      ));
    }
  };

  private renderStatusPage(title: string, message: string, confirmationCode?: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; background: #0f0f0f; color: #f5f5f5; font-family: Arial, sans-serif; }
    main { max-width: 680px; margin: 12vh auto; padding: 32px; background: #1b1b1b; border: 1px solid #333; border-radius: 14px; }
    h1 { margin-top: 0; font-size: 28px; }
    p { color: #d4d4d4; line-height: 1.6; }
    code { display: inline-block; padding: 8px 10px; background: #101010; border-radius: 6px; color: #ff7a1a; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
    ${confirmationCode ? `<p>Confirmation code:</p><code>${confirmationCode}</code>` : ""}
  </main>
</body>
</html>`;
  }
}

export default new FacebookDataDeletionController();
