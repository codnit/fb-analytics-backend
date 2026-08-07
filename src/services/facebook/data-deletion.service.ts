import crypto from "crypto";
import { getDB } from "../../config/database";
import { hashFacebookDeletionIdentifier } from "../../utils/facebookDataDeletion";
import storageService from "../storage.service";
import { notificationEventBus } from "../notifications/notification.events";

export interface FacebookDataDeletionResult {
  confirmationCode: string;
  status: string;
  statusMessage: string;
}

const COMPLETED_MESSAGE =
  "The PIB partner account and all associated platform data have been permanently deleted.";
const NOT_FOUND_MESSAGE = "No stored PIB partner account or associated data was found for this request.";

export class FacebookDataDeletionService {
  async deleteFacebookDataForUser(
    facebookUserId: string,
    appSecret: string
  ): Promise<FacebookDataDeletionResult> {
    const db = getDB();
    const userIdHash = hashFacebookDeletionIdentifier(facebookUserId, appSecret);
    const existingRequest = await db.facebookDataDeletionRequest.findUnique({
      where: { user_id_hash: userIdHash },
    });
    const currentlyConnectedPartner = await db.partner.findUnique({
      where: { user_id: facebookUserId },
      select: { id: true },
    });

    if (existingRequest?.status === "completed" && !currentlyConnectedPartner) {
      return {
        confirmationCode: existingRequest.confirmation_code,
        status: existingRequest.status,
        statusMessage: existingRequest.status_message || COMPLETED_MESSAGE,
      };
    }

    const confirmationCode = existingRequest?.confirmation_code || crypto.randomBytes(16).toString("hex");

    await db.$transaction(async (tx) => {
      await tx.facebookDataDeletionRequest.upsert({
        where: { user_id_hash: userIdHash },
        create: {
          user_id_hash: userIdHash,
          confirmation_code: confirmationCode,
          status: currentlyConnectedPartner ? "processing" : "completed",
          status_message: currentlyConnectedPartner ? null : NOT_FOUND_MESSAGE,
          completed_at: currentlyConnectedPartner ? null : new Date(),
        },
        update: {
          status: currentlyConnectedPartner ? "processing" : "completed",
          status_message: currentlyConnectedPartner ? null : NOT_FOUND_MESSAGE,
          completed_at: currentlyConnectedPartner ? null : new Date(),
        },
      });

      if (currentlyConnectedPartner) {
        await tx.partner.updateMany({
          where: {
            id: currentlyConnectedPartner.id,
            user_id: facebookUserId,
          },
          data: {
            facebook_user_token_encrypted: null,
            facebook_data_deleted_at: new Date(),
          },
        });
        await tx.connectedPage.updateMany({
          where: { partner_id: currentlyConnectedPartner.id },
          data: {
            page_token_encrypted: null,
            publishing_enabled: false,
            is_active: false,
            facebook_reauth_required: false,
            facebook_reauth_required_at: null,
            facebook_reauth_reason: null,
          },
        });
      }
    });

    if (!currentlyConnectedPartner) {
      return {
        confirmationCode,
        status: "completed",
        statusMessage: NOT_FOUND_MESSAGE,
      };
    }

    const pages = await db.connectedPage.findMany({
      where: { partner_id: currentlyConnectedPartner.id },
      select: { id: true, fb_page_id: true },
    });
    const connectedPageIds = pages.map((page) => page.id);
    const publishingPosts = await db.publishingPost.findMany({
      where: {
        OR: [
          { created_by: currentlyConnectedPartner.id },
          ...(connectedPageIds.length > 0 ? [{ page_id: { in: connectedPageIds } }] : []),
        ],
      },
      select: { media_object_key: true },
    });
    const mediaObjectKeys = Array.from(new Set<string>(
      publishingPosts
        .map((post: { media_object_key?: unknown }) => post.media_object_key)
        .filter((key: unknown): key is string => typeof key === "string" && key.length > 0)
    ));

    if (mediaObjectKeys.length > 0 && !storageService.isConfigured()) {
      throw new Error("Publishing storage is not configured; uploaded media cannot be deleted safely");
    }

    await Promise.all(mediaObjectKeys.map((key) => storageService.deleteObject(key)));

    const deletionResult = await db.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({
        where: { id: currentlyConnectedPartner.id },
      });

      if (!partner) {
        const request = await tx.facebookDataDeletionRequest.update({
          where: { user_id_hash: userIdHash },
          data: {
            status: "completed",
            status_message: COMPLETED_MESSAGE,
            completed_at: new Date(),
          },
        });

        return {
          confirmationCode: request.confirmation_code,
          status: request.status,
          statusMessage: request.status_message || COMPLETED_MESSAGE,
        };
      }

      const storedPages = await tx.connectedPage.findMany({
        where: { partner_id: partner.id },
        select: { id: true, fb_page_id: true },
      });
      const connectedPageIds = storedPages.map((page) => page.id);
      const facebookPageIds = storedPages.map((page) => page.fb_page_id);
      const pageLookupIds = [...connectedPageIds, ...facebookPageIds];

      const posts = pageLookupIds.length > 0
        ? await tx.post.findMany({
          where: { page_id: { in: pageLookupIds } },
          select: { id: true, fb_post_id: true },
        })
        : [];
      const postIds = posts.map((post) => post.id);
      const facebookPostIds = posts.map((post) => post.fb_post_id);
      const postLookupIds = [...postIds, ...facebookPostIds];

      await tx.notification.deleteMany({
        where: {
          OR: [
            { recipient_partner_id: partner.id },
            ...(connectedPageIds.length > 0 ? [{ connected_page_id: { in: connectedPageIds } }] : []),
          ],
        },
      });

      if (connectedPageIds.length > 0) {
        await tx.syncJob.deleteMany({
          where: { page_id: { in: connectedPageIds } },
        });
      }

      if (connectedPageIds.length > 0 || postIds.length > 0) {
        await tx.thirdPartyData.deleteMany({
          where: {
            OR: [
              ...(connectedPageIds.length > 0 ? [{ page_id: { in: connectedPageIds } }] : []),
              ...(postIds.length > 0 ? [{ post_id: { in: postIds } }] : []),
            ],
          },
        });
      }

      if (postLookupIds.length > 0) {
        await tx.postInsight.deleteMany({
          where: { post_id: { in: postLookupIds } },
        });
        await tx.cmEarningsPost.deleteMany({
          where: { post_id: { in: postLookupIds } },
        });
      }

      if (pageLookupIds.length > 0) {
        await tx.pageInsight.deleteMany({
          where: { page_id: { in: pageLookupIds } },
        });
        await tx.cmEarningsPage.deleteMany({
          where: { page_id: { in: pageLookupIds } },
        });
        await tx.post.deleteMany({
          where: { page_id: { in: pageLookupIds } },
        });
      }

      await tx.publishingPost.deleteMany({
        where: {
          OR: [
            { created_by: partner.id },
            ...(connectedPageIds.length > 0 ? [{ page_id: { in: connectedPageIds } }] : []),
          ],
        },
      });

      if (connectedPageIds.length > 0) {
        await tx.connectedPage.deleteMany({
          where: { id: { in: connectedPageIds } },
        });
      }

      await tx.partner.delete({ where: { id: partner.id } });

      const request = await tx.facebookDataDeletionRequest.update({
        where: { user_id_hash: userIdHash },
        data: {
          status: "completed",
          status_message: COMPLETED_MESSAGE,
          completed_at: new Date(),
        },
      });

      return {
        confirmationCode: request.confirmation_code,
        status: request.status,
        statusMessage: request.status_message || COMPLETED_MESSAGE,
      };
    });

    void notificationEventBus.publish(currentlyConnectedPartner.id, {
      id: crypto.randomUUID(),
      type: "partner_account_deleted",
      title: "Partner account deleted",
      message: "Your PIB partner account and associated data were permanently deleted.",
      is_read: true,
      created_at: new Date(),
    });

    return deletionResult;
  }

  async getStatus(confirmationCode: string): Promise<FacebookDataDeletionResult | null> {
    const request = await getDB().facebookDataDeletionRequest.findUnique({
      where: { confirmation_code: confirmationCode },
    });

    if (!request) {
      return null;
    }

    return {
      confirmationCode: request.confirmation_code,
      status: request.status,
      statusMessage: request.status_message || "Your Facebook data deletion request is being processed.",
    };
  }
}

export default new FacebookDataDeletionService();
