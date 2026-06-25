import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "Access denied. No admin token provided."
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
    
    if (decoded.role !== "admin") {
      res.status(403).json({
        success: false,
        message: "Access denied. Admin role required."
      });
      return;
    }

    (req as any).adminId = decoded.id;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired admin token."
    });
  }
};

export default adminAuth;
