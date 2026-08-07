import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getDB } from "../config/database";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export const partnerAuth = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const authHeader = req.headers.authorization;

  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Partner authentication required.",
      code: "PARTNER_AUTH_REQUIRED",
    });
  }

  let decoded: { id?: string; role?: string };
  try {
    decoded = jwt.verify(authHeader.slice("Bearer ".length), JWT_SECRET) as { id?: string; role?: string };
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired partner token.",
      code: "PARTNER_SESSION_EXPIRED",
    });
  }

  if (decoded.role !== "partner" || !decoded.id) {
    return res.status(403).json({ success: false, message: "Partner access required." });
  }

  try {
    const partner = await getDB().partner.findUnique({
      where: { id: decoded.id },
      select: { id: true, facebook_data_deleted_at: true },
    });

    if (!partner || partner.facebook_data_deleted_at) {
      return res.status(401).json({
        success: false,
        message: "This partner account has been deleted or is being deleted.",
        code: "PARTNER_ACCOUNT_DELETED",
      });
    }

    (req as any).partnerId = partner.id;
    return next();
  } catch (error) {
    return next(error);
  }
};

export default partnerAuth;
