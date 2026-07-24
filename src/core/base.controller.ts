import type { Response } from "express";
import type { ApiResponse } from "../types/http";
import { FACEBOOK_REAUTH_REQUIRED, isFacebookTokenError } from "../utils/facebookAuthError";

export abstract class BaseController {
  protected ok<T>(res: Response<ApiResponse<T>>, data: T, message = "Success", statusCode = 200): Response<ApiResponse<T>> {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  protected created<T>(res: Response<ApiResponse<T>>, data: T, message = "Created"): Response<ApiResponse<T>> {
    return this.ok(res, data, message, 201);
  }

  protected notFound(res: Response<ApiResponse<null>>, message = "Resource not found"): Response<ApiResponse<null>> {
    return res.status(404).json({
      success: false,
      message,
      data: null,
    });
  }

  protected badRequest(res: Response<ApiResponse<null>>, message: string, error?: unknown): Response<ApiResponse<null>> {
    return res.status(400).json({
      success: false,
      message,
      error,
      data: null,
    });
  }

  protected fail<T>(res: Response<ApiResponse<T>>, message: string, statusCode = 500, error?: unknown): Response<ApiResponse<T>> {
    if (isFacebookTokenError(error) || isFacebookTokenError(message)) {
      return res.status(401).json({
        success: false,
        message: "Facebook authorization has expired or is no longer valid. Please reconnect Facebook.",
        code: FACEBOOK_REAUTH_REQUIRED,
      });
    }

    return res.status(statusCode).json({
      success: false,
      message,
      error,
    });
  }
}
