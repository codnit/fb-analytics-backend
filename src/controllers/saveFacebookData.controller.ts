import type { Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import { facebookSyncQueue } from "../queues/facebookSync.queue";
import saveFacebookDataService from "../services/saveFacebookData.service";
import insightsService from "../services/insights.service";
import connectedPageRepository from "../repositories/ConnectedPage";
import partnerRepository from "../repositories/Partner";
import { isPartnerOnboardingComplete } from "../utils/partnerOnboarding";
import { resolveStoredToken } from "../utils/insight-cache.helpers";
import { isFacebookTokenError } from "../utils/facebookAuthError";
import {
  DEFAULT_SYNC_WINDOW_DAYS,
  DEFAULT_POST_FETCH_LIMIT,
  DEFAULT_POST_WRITE_CHUNK,
  DEFAULT_PAGE_METRICS,
  DEFAULT_POST_METRICS,
} from "../services/facebookSync.presets";

import jwt from "jsonwebtoken";
import type { FacebookTokenMetadata } from "../types/http";
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export class SaveFacebookDataController extends BaseController {
  initialConnectionSync = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const body = req.body as { access_token?: string; accessToken?: string; registrationData?: any };
      const authReq = req as Request & {
        facebookAuth?: {
          userLongToken?: string;
          tokenMetadata?: FacebookTokenMetadata;
        };
      };
      const accessToken = authReq.facebookAuth?.userLongToken || body.access_token || body.accessToken;

      if (!accessToken) {
        return this.badRequest(res, "access_token is required");
      }

      const authHeader = req.headers.authorization as string | undefined;
      let partnerId: string | undefined = undefined;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          partnerId = decoded.id;
        } catch (e) {}
      }

      if (partnerId) {
        const authenticatedPartner = await partnerRepository.getPartnerById(partnerId);
        if (!authenticatedPartner || authenticatedPartner.facebook_data_deleted_at) {
          return res.status(401).json({
            success: false,
            message: "This partner account has been deleted or is being deleted.",
            code: "PARTNER_ACCOUNT_DELETED",
          });
        }
      }

      const result = await saveFacebookDataService.initialConnectionSync(accessToken, body.registrationData, partnerId);
      const needsAdditionalInfo = !isPartnerOnboardingComplete(result.partner);
      const partnerToken = !needsAdditionalInfo && result.partner?.id
        ? jwt.sign({ id: result.partner.id, role: "partner" }, JWT_SECRET, { expiresIn: "30d" })
        : null;

      return this.ok(
        res,
        {
          ...result,
          accessToken,
          tokenMetadata: authReq.facebookAuth?.tokenMetadata || null,
          needsAdditionalInfo,
          partnerToken,
        },
        "Initial connection sync complete"
      );
    } catch (error) {
      return this.fail(res, error instanceof Error ? error.message : String(error), 500, error);
    }
  };

  diagnostics = async (_req: Request, res: Response): Promise<Response | void> => {
    try {
      const queue = await facebookSyncQueue.getDiagnostics();

      return this.ok(res, {
        apiProcess: true,
        nodeEnv: process.env.NODE_ENV || "development",
        queue,
      }, "Facebook sync diagnostics");
    } catch (error) {
      return this.fail(res, error instanceof Error ? error.message : String(error), 500, error);
    }
  };

  syncPageManual = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { page_access_token, partner_id, page_id } = req.body as { page_access_token?: string; partner_id?: string; page_id?: string };
      
      if (!page_access_token) {
        return this.badRequest(res, "page_access_token is required");
      }

      const targetPageId = page_id || "me";
      const pageDetailsResponse = await insightsService.getPageDetails(targetPageId, { access_token: page_access_token });
      const fbPage = pageDetailsResponse.data;
      
      if (!fbPage || !fbPage.id) {
        return this.badRequest(res, "Could not fetch page details with provided token");
      }
      
      let finalPartnerId = partner_id;
      if (finalPartnerId) {
        if (typeof finalPartnerId !== "string") {
          return this.badRequest(res, "partner_id must be a string");
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(finalPartnerId);
        
        if (isUuid) {
          const partner = await partnerRepository.getPartnerById(finalPartnerId);
          if (!partner) {
            return this.badRequest(res, `Partner with ID ${finalPartnerId} not found`);
          }
        } else {
          const partner = await partnerRepository.getPartnerByUserId(finalPartnerId);
          if (!partner) {
            return this.badRequest(res, `Partner with Facebook User ID ${finalPartnerId} not found`);
          }
          finalPartnerId = partner.id;
        }
      } else {
        const existingPage = await connectedPageRepository.getPageByFbPageId(fbPage.id);
        if (existingPage) {
          finalPartnerId = existingPage.partner_id;
        } else {
          return this.badRequest(res, "partner_id is required for pages that are not yet connected");
        }
      }

      fbPage.access_token = page_access_token;

      const job = await facebookSyncQueue.enqueuePageSync({
        partnerId: finalPartnerId,
        accessToken: page_access_token,
        facebookPage: fbPage,
        syncWindowDays: DEFAULT_SYNC_WINDOW_DAYS,
        postBatchSize: DEFAULT_POST_FETCH_LIMIT,
        postWriteChunkSize: DEFAULT_POST_WRITE_CHUNK,
        pageMetrics: DEFAULT_PAGE_METRICS,
        postMetrics: DEFAULT_POST_METRICS,
      });

      return this.ok(res, {
        message: "Manual page sync enqueued successfully",
        jobId: job.id,
        fbPageId: fbPage.id,
        pageName: fbPage.name
      }, "Page sync enqueued");
      
    } catch (error) {
      return this.fail(res, error instanceof Error ? error.message : String(error), 500, error);
    }
  };

  syncStoredPageAsAdmin = async (req: Request, res: Response): Promise<Response | void> => {
    let reconnectPageId: string | null = null;

    try {
      const { partnerId, pageId } = req.params as { partnerId?: string; pageId?: string };

      if (!partnerId || !pageId) {
        return this.badRequest(res, "partnerId and pageId are required");
      }

      const partner = await partnerRepository.getPartnerById(partnerId);
      if (!partner) {
        return this.notFound(res, "Partner not found");
      }

      const partnerPages = await connectedPageRepository.getPartnerPages(partnerId);
      const connectedPage = partnerPages.find(
        (page) => page.id === pageId || page.fb_page_id === pageId
      );

      if (!connectedPage) {
        return this.notFound(res, "Page not found for this partner");
      }
      reconnectPageId = connectedPage.id;

      const pageAccessToken = resolveStoredToken(connectedPage.page_token_encrypted);
      if (!pageAccessToken) {
        await connectedPageRepository.markFacebookReauthRequired(
          connectedPage.id,
          "missing_page_token"
        );
        return res.status(409).json({
          success: false,
          message: "The stored Page authorization is not available. The partner must reconnect Facebook.",
          code: "PAGE_REAUTH_REQUIRED",
        });
      }

      const facebookValidationStartedAt = new Date();
      const pageDetailsResponse = await insightsService.getPageDetails(
        connectedPage.fb_page_id,
        { access_token: pageAccessToken }
      );
      const fbPage = pageDetailsResponse.data;

      if (!fbPage?.id || fbPage.id !== connectedPage.fb_page_id) {
        return this.badRequest(res, "Stored Page access token does not match the selected Page");
      }

      fbPage.access_token = pageAccessToken;
      await connectedPageRepository.clearFacebookReauthRequired(
        connectedPage.id,
        facebookValidationStartedAt
      );

      const job = await facebookSyncQueue.enqueuePageSync({
        partnerId: connectedPage.partner_id,
        accessToken: pageAccessToken,
        facebookPage: fbPage,
        syncWindowDays: DEFAULT_SYNC_WINDOW_DAYS,
        postBatchSize: DEFAULT_POST_FETCH_LIMIT,
        postWriteChunkSize: DEFAULT_POST_WRITE_CHUNK,
        pageMetrics: DEFAULT_PAGE_METRICS,
        postMetrics: DEFAULT_POST_METRICS,
      });

      return this.ok(
        res,
        {
          jobId: job.id ? String(job.id) : null,
          fbPageId: fbPage.id,
          pageName: fbPage.name || connectedPage.page_name || null,
        },
        "Admin Page re-sync enqueued",
        202
      );
    } catch (error) {
      if (isFacebookTokenError(error)) {
        if (reconnectPageId) {
          try {
            await connectedPageRepository.markFacebookReauthRequired(reconnectPageId);
          } catch (statusError) {
            console.error(`Failed to mark page ${reconnectPageId} for Facebook reconnection:`, statusError);
          }
        }
        return res.status(409).json({
          success: false,
          message: "The stored Page authorization has expired or is no longer valid. The partner must reconnect Facebook.",
          code: "PAGE_REAUTH_REQUIRED",
        });
      }

      return this.fail(
        res,
        error instanceof Error ? error.message : String(error),
        500,
        error
      );
    }
  };

}


export default new SaveFacebookDataController();
