import axios from "axios";
import type { NextFunction, Request, Response } from "express";
import { Environment } from "../config/environment";
import type { FacebookTokenMetadata } from "../types/http";
import { FACEBOOK_REAUTH_REQUIRED, isFacebookTokenError } from "../utils/facebookAuthError";

const toEpochMilliseconds = (value: unknown): number | null => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

export class FacebookTokenMiddleware {
  exchangeToken = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const body = req.body as { accessToken?: string; access_token?: string };
      const shortToken = body.accessToken || body.access_token;

      if (!shortToken) {
        return res.status(400).json({ error: "Access token required" });
      }

      const longTokenRes = await axios.get(`${Environment.facebookOauthBaseUrl}/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: Environment.fbAppId,
          client_secret: Environment.fbAppSecret,
          fb_exchange_token: shortToken,
        },
      });

      const longLivedToken = longTokenRes.data.access_token as string;

      const fallbackExpiresInSeconds = Number(longTokenRes.data.expires_in);
      let tokenMetadata: FacebookTokenMetadata = {
        tokenType: "USER",
        isValid: true,
        issuedAt: Date.now(),
        expiresAt:
          Number.isFinite(fallbackExpiresInSeconds) && fallbackExpiresInSeconds > 0
            ? Date.now() + fallbackExpiresInSeconds * 1000
            : null,
        dataAccessExpiresAt: null,
      };

      const tokenDebugPromise = Environment.facebookAppAccessToken
        ? axios
            .get(`${Environment.facebookGraphBaseUrl}/debug_token`, {
              params: {
                input_token: longLivedToken,
                access_token: Environment.facebookAppAccessToken,
              },
            })
            .catch((error) => {
              console.warn(
                "Facebook token metadata lookup failed; connection will continue:",
                axios.isAxiosError(error) ? error.response?.data || error.message : error
              );
              return null;
            })
        : Promise.resolve(null);

      const [pagesRes, tokenDebugRes] = await Promise.all([
        axios.get(`${Environment.facebookOauthBaseUrl}/me/accounts`, {
          params: {
            access_token: longLivedToken,
          },
        }),
        tokenDebugPromise,
      ]);

      const debugData = tokenDebugRes?.data?.data;
      if (debugData) {
        tokenMetadata = {
          tokenType: typeof debugData.type === "string" ? debugData.type : tokenMetadata.tokenType,
          isValid: typeof debugData.is_valid === "boolean" ? debugData.is_valid : tokenMetadata.isValid,
          issuedAt:
            debugData.issued_at !== undefined
              ? toEpochMilliseconds(debugData.issued_at)
              : tokenMetadata.issuedAt,
          expiresAt:
            debugData.expires_at !== undefined
              ? toEpochMilliseconds(debugData.expires_at)
              : tokenMetadata.expiresAt,
          dataAccessExpiresAt:
            debugData.data_access_expires_at !== undefined
              ? toEpochMilliseconds(debugData.data_access_expires_at)
              : tokenMetadata.dataAccessExpiresAt,
        };
      }

      const authReq = req as Request & {
        facebookAuth?: {
          userLongToken?: string;
          pages?: unknown[];
          tokenMetadata?: FacebookTokenMetadata;
        };
      };

      authReq.facebookAuth = {
        userLongToken: longLivedToken,
        pages: pagesRes.data.data,
        tokenMetadata,
      };

      return next();
    } catch (error) {
      console.error("FB Middleware Error:", axios.isAxiosError(error) ? error.response?.data || error.message : error);
      if (isFacebookTokenError(error)) {
        return res.status(401).json({
          success: false,
          message: "Facebook authorization has expired or is no longer valid. Please reconnect Facebook.",
          code: FACEBOOK_REAUTH_REQUIRED,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Facebook token exchange failed",
      });
    }
  };
}

export default new FacebookTokenMiddleware().exchangeToken;
