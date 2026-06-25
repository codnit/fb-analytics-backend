import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { getDB } from "../config/database";
import { BaseController } from "../core/base.controller";
import { Environment } from "../config/environment";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export class AdminAuthController extends BaseController {
  
  async ensureAdminExists() {
    const defaultAdminEmail = "ops@publisherinabox.com";
    const defaultAdminPassword = "ops@5590";
    const admin = await getDB().admin.findUnique({ where: { email: defaultAdminEmail } });
    if (!admin) {
      const password_hash = await bcrypt.hash(defaultAdminPassword, 10);
      await getDB().admin.create({
        data: { email: defaultAdminEmail, password_hash }
      });
      console.log(`Admin seeded: ${defaultAdminEmail} / ${defaultAdminPassword}`);
    }
  }

  login = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      await this.ensureAdminExists();

      const { email, password } = req.body;
      if (!email || !password) {
        return this.badRequest(res, "Email and password required");
      }

      const admin = await getDB().admin.findUnique({ where: { email } });
      if (!admin) {
        return this.fail(res, "Invalid credentials", 401);
      }

      const isMatch = await bcrypt.compare(password, admin.password_hash);
      if (!isMatch) {
        return this.fail(res, "Invalid credentials", 401);
      }

      const token = jwt.sign({ id: admin.id, role: "admin" }, JWT_SECRET, { expiresIn: "1d" });
      
      return this.ok(res, { token }, "Logged in successfully");
    } catch (error) {
      return next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      await this.ensureAdminExists();
      const { email } = req.body;

      const admin = await getDB().admin.findUnique({ where: { email } });
      if (!admin) {
        // Return 200 anyway for security (so we don't leak registered emails)
        return this.ok(res, null, "If email exists, a reset link was sent.");
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = await bcrypt.hash(resetToken, 10);

      await getDB().admin.update({
        where: { id: admin.id },
        data: {
          reset_token: hashedToken,
          reset_token_expiry: new Date(Date.now() + 3600000), // 1 hour
        }
      });

      // Send Email
      let transporter;
      if (process.env.SMTP_HOST) {
        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        });
      } else {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
      }

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const resetUrl = `${frontendUrl}/admin/reset-password?token=${resetToken}&email=${email}`;

      const info = await transporter.sendMail({
        from: '"Admin System" <noreply@admin.com>',
        to: email,
        subject: "Password Reset Request",
        text: `You requested a password reset. Click the link to reset your password: ${resetUrl}`,
        html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p>`
      });

      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));

      return this.ok(res, null, "If email exists, a reset link was sent.");
    } catch (error) {
      return next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { email, token, password } = req.body;

      const admin = await getDB().admin.findUnique({ where: { email } });
      if (!admin || !admin.reset_token || !admin.reset_token_expiry) {
        return this.badRequest(res, "Invalid or expired token");
      }

      if (admin.reset_token_expiry < new Date()) {
        return this.badRequest(res, "Token expired");
      }

      const isValidToken = await bcrypt.compare(token, admin.reset_token);
      if (!isValidToken) {
        return this.badRequest(res, "Invalid token");
      }

      const newPasswordHash = await bcrypt.hash(password, 10);

      await getDB().admin.update({
        where: { id: admin.id },
        data: {
          password_hash: newPasswordHash,
          reset_token: null,
          reset_token_expiry: null,
        }
      });

      return this.ok(res, null, "Password reset successful");
    } catch (error) {
      return next(error);
    }
  };
}

export default new AdminAuthController();
