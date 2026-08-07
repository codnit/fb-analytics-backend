import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { getDB } from "../config/database";
import { BaseController } from "../core/base.controller";
import partnerRepository from "../repositories/Partner";
import type { PartnerCreateInput } from "../types/domain";
import { isPartnerOnboardingComplete } from "../utils/partnerOnboarding";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export class AuthController extends BaseController {
  
  register = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { email, password, name, phone, country, company, publisher_type, website_url, niche_category, reason_joining } = req.body;
      
      if (!email || !password) {
        return this.badRequest(res, "Email and password required");
      }

      const existingPartner = await getDB().partner.findFirst({ where: { email } });
      if (existingPartner) {
        return this.fail(res, "Email already in use", 409);
      }

      const password_hash = await bcrypt.hash(password, 10);
      const user_id = uuidv4(); // Generate a unique user_id since they don't have a FB ID yet

      const partnerInput: PartnerCreateInput = {
        user_id,
        email,
        password_hash,
        name,
        phone,
        country,
        company,
        publisher_type,
        website_url,
        niche_category,
        reason_joining,
      };

      const partner = await partnerRepository.upsertPartner(partnerInput);
      const token = jwt.sign({ id: partner.id, role: "partner" }, JWT_SECRET, { expiresIn: "30d" });

      return this.ok(res, { token, partner }, "Registered successfully");
    } catch (error) {
      return next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return this.badRequest(res, "Email and password required");
      }

      const partner = await getDB().partner.findFirst({ where: { email } });
      if (!partner || !partner.password_hash) {
        return this.fail(res, "Invalid credentials", 401);
      }

      if (partner.facebook_data_deleted_at) {
        return res.status(401).json({
          success: false,
          message: "This partner account is being deleted.",
          code: "PARTNER_ACCOUNT_DELETED",
        });
      }

      const isMatch = await bcrypt.compare(password, partner.password_hash);
      if (!isMatch) {
        return this.fail(res, "Invalid credentials", 401);
      }

      const token = jwt.sign({ id: partner.id, role: "partner" }, JWT_SECRET, { expiresIn: "30d" });
      
      return this.ok(res, { token, partner }, "Logged in successfully");
    } catch (error) {
      return next(error);
    }
  };

  completeFacebookOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const {
        partnerId,
        name,
        email,
        phone,
        country,
        company,
        publisher_type,
        website_url,
        niche_category,
        reason_joining,
      } = req.body ?? {};

      if (!partnerId || typeof partnerId !== "string") {
        return this.badRequest(res, "partnerId is required");
      }

      const existingPartner = await partnerRepository.getPartnerById(partnerId);
      if (!existingPartner) {
        return this.notFound(res, "Partner not found");
      }

      const updates: Partial<PartnerCreateInput> = {
        name,
        email,
        phone,
        country,
        company,
        publisher_type,
        website_url,
        niche_category,
        reason_joining,
      };

      const mergedPartner = {
        ...existingPartner,
        ...updates,
      };

      if (!isPartnerOnboardingComplete(mergedPartner)) {
        return this.badRequest(res, "Please complete all required fields.");
      }

      const partner = await partnerRepository.updatePartner(partnerId, updates);
      const token = jwt.sign({ id: partner.id, role: "partner" }, JWT_SECRET, { expiresIn: "30d" });

      return this.ok(res, { token, partner }, "Onboarding completed successfully");
    } catch (error) {
      return next(error);
    }
  };
  
  me = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const authHeader = req.headers.authorization as string | undefined;
      if (!authHeader?.startsWith("Bearer ")) {
        return this.fail(res, "No token provided", 401);
      }
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string, role: string };
      
      const partner = await partnerRepository.getPartnerById(decoded.id);
      if (!partner || partner.facebook_data_deleted_at) {
        return res.status(401).json({
          success: false,
          message: "This partner account has been deleted or is being deleted.",
          code: "PARTNER_ACCOUNT_DELETED",
        });
      }
      
      return this.ok(res, { partner }, "Fetched profile");
    } catch (error) {
      return this.fail(res, "Invalid token", 401);
    }
  };
}

export default new AuthController();
