import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Environment } from "../config/environment";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const readHeaderValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
};

export const publishingAuth = (req: Request, res: Response, next: NextFunction): Response | void => {
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
        (req as any).publishingActor = { id: decoded.id, type: "admin" };
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
