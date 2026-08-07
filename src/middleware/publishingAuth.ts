import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Environment } from "../config/environment";
import { getDB } from "../config/database";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const readHeaderValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
};

export const publishingAuth = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const apiKey = readHeaderValue(req.headers["x-api-key"]);
  const expectedApiKey = Environment.publishingApiKey;

  if (expectedApiKey && apiKey && apiKey === expectedApiKey) {
    (req as any).publishingActor = { id: "internal-api", type: "api" };
    return next();
  }

  const authHeader = readHeaderValue(req.headers.authorization);
  if (authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as { id: string; role: string };
      if (decoded.role === "admin") {
        (req as any).publishingActor = { id: decoded.id, type: decoded.role };
        return next();
      }

      if (decoded.role === "partner") {
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

        (req as any).publishingActor = { id: partner.id, type: "partner" };
        return next();
      }
    } catch {}
  }

  return res.status(401).json({
    success: false,
    message: "Unauthorized",
  });
};

export default publishingAuth;
