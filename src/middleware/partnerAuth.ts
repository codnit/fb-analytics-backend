import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export const partnerAuth = (req: Request, res: Response, next: NextFunction): Response | void => {
  const authHeader = req.headers.authorization;

  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Partner authentication required." });
  }

  try {
    const decoded = jwt.verify(authHeader.slice("Bearer ".length), JWT_SECRET) as { id?: string; role?: string };
    if (decoded.role !== "partner" || !decoded.id) {
      return res.status(403).json({ success: false, message: "Partner access required." });
    }

    (req as any).partnerId = decoded.id;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired partner token." });
  }
};

export default partnerAuth;
