import type {
  InitialConnectionSyncResult,
  PageSyncJobPayload,
  PageSyncJobResult,
  PostSyncJobPayload,
  PostSyncJobResult,
} from "../types/facebookSync";
import orchestrator from "./facebook/sync.orchestrator";

export class SaveFacebookDataService {
  async initialConnectionSync(accessToken: string, registrationData?: any, partnerId?: string) {
    return orchestrator.initialConnectionSync(accessToken, registrationData, partnerId);
  }

  processPageSyncJob(payload: PageSyncJobPayload): Promise<PageSyncJobResult> {
    return orchestrator.processPageSyncJob(payload);
  }

  processPostSyncJob(payload: PostSyncJobPayload): Promise<PostSyncJobResult> {
    return orchestrator.processPostSyncJob(payload);
  }
}

export default new SaveFacebookDataService();
