import insightsService from "../insights.service";
import partnerRepository from "../../repositories/Partner";
import type { PartnerCreateInput, PartnerEntity } from "../../types/domain";
import { encryptPageToken as encryptFacebookUserToken } from "../../utils/pageTokenCrypto";

export class PartnerSyncService {
  async syncPartner(accessToken: string, registrationData?: any, partnerId?: string): Promise<PartnerEntity> {
    const fbUser = await insightsService.getUserDetails({ access_token: accessToken });
    const user = fbUser.data as { id: string; name?: string; email?: string };

    const partnerInput: Partial<PartnerCreateInput> = {
      name: registrationData?.name || user.name || undefined,
      email: registrationData?.email || user.email || undefined,
      phone: registrationData?.phone || undefined,
      country: registrationData?.country || undefined,
      company: registrationData?.company || undefined,
      publisher_type: registrationData?.publisher_type || undefined,
      website_url: registrationData?.website_url || undefined,
      niche_category: registrationData?.niche_category || undefined,
      reason_joining: registrationData?.reason_joining || undefined,
      facebook_user_token_encrypted: encryptFacebookUserToken(accessToken),
      facebook_data_deleted_at: null,
    };
    
    // Remove undefined values
    Object.keys(partnerInput).forEach(key => partnerInput[key as keyof typeof partnerInput] === undefined && delete partnerInput[key as keyof typeof partnerInput]);

    if (partnerId) {
      partnerInput.user_id = user.id;
      const savedPartner = await partnerRepository.updatePartner(partnerId, partnerInput);
      const { facebook_user_token_encrypted: _storedToken, ...safePartner } = savedPartner;
      return safePartner;
    } else {
      const fullInput: PartnerCreateInput = {
        user_id: user.id,
        ...partnerInput
      };
      const savedPartner = await partnerRepository.upsertPartner(fullInput);
      const { facebook_user_token_encrypted: _storedToken, ...safePartner } = savedPartner;
      return safePartner;
    }
  }
}

export default new PartnerSyncService();
