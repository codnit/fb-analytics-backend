import type { NextFunction, Request, Response } from "express";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  code?: string;
  data?: T;
  pagination?: PaginationMeta;
  error?: unknown;
}

export type TypedRequest<
  Params = Record<string, string>,
  Body = Record<string, unknown>,
  Query = Record<string, string | string[] | undefined>,
> = Request<Params, unknown, Body, Query>;

export interface AuthContext<T = unknown> {
  userLongToken?: string;
  pages?: T[];
  tokenMetadata?: FacebookTokenMetadata;
}

export interface FacebookTokenMetadata {
  tokenType?: string | null;
  isValid?: boolean | null;
  issuedAt?: number | null;
  expiresAt?: number | null;
  dataAccessExpiresAt?: number | null;
}

export interface AuthenticatedRequest<
  Params = Record<string, string>,
  Body = Record<string, unknown>,
  Query = Record<string, string | string[] | undefined>,
  Auth = AuthContext
> extends Request<Params, unknown, Body, Query> {
  facebookAuth?: Auth;
  fbData?: Auth;
}

export type TypedResponse<T = unknown> = Response<ApiResponse<T>>;
export type ControllerResult<T = unknown> = Promise<Response<ApiResponse<T>> | void> | Response<ApiResponse<T>> | void;
export type AsyncHandler<Params = Record<string, string>, Body = Record<string, unknown>, Query = Record<string, string | string[] | undefined>> =
  (req: TypedRequest<Params, Body, Query>, res: TypedResponse, next: NextFunction) => Promise<void> | void;
