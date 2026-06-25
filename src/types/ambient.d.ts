declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  on(event: string, listener: (...args: any[]) => void): void;
};

interface ErrorConstructor {
  captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
}

declare module "dotenv/config";

declare module "express" {
  export interface Request<Params = any, ResBody = any, ReqBody = any, ReqQuery = any> {
    params: Params;
    body: ReqBody;
    query: ReqQuery;
    originalUrl: string;
    method: string;
    ip: string;
    socket: { remoteAddress?: string };
    headers: Record<string, string | string[] | undefined>;
  }

  export interface Response<ResBody = any> {
    status(code: number): Response<ResBody>;
    json(body: ResBody): Response<ResBody>;
    send(body?: any): Response<ResBody>;
    sendFile(path: string, options?: any, callback?: (err?: Error) => void): void;
    setHeader(name: string, value: string | string[]): Response<ResBody>;
    write(chunk: any, ...args: any[]): boolean;
    end(chunk?: any, ...args: any[]): Response<ResBody>;
    statusCode: number;
  }

  export type NextFunction = (err?: any) => void;
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => any;
  export type ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => any;

  export interface Router {
    get(path: string, ...handlers: RequestHandler[]): Router;
    post(path: string, ...handlers: RequestHandler[]): Router;
    put(path: string, ...handlers: RequestHandler[]): Router;
    patch(path: string, ...handlers: RequestHandler[]): Router;
    delete(path: string, ...handlers: RequestHandler[]): Router;
    use(path: string, ...handlers: Array<RequestHandler | ErrorRequestHandler | Router>): Router;
    use(...handlers: Array<RequestHandler | ErrorRequestHandler | Router>): Router;
  }

  export interface Application extends Router {
    set(setting: string, value: any): Application;
    listen(port: number | string, callback?: () => void): { close(callback?: () => void): void };
  }

  export interface ExpressStatic {
    (): Application;
    json(options?: any): RequestHandler;
    urlencoded(options?: any): RequestHandler;
  }

  export const express: ExpressStatic;
  export default express;
  export function Router(): Router;
}

declare module "cors" {
  import type { RequestHandler } from "express";
  const cors: (options?: any) => RequestHandler;
  export default cors;
}

declare module "helmet" {
  import type { RequestHandler } from "express";
  const helmet: (options?: any) => RequestHandler;
  export default helmet;
}

declare module "morgan" {
  import type { RequestHandler } from "express";
  const morgan: (format?: string) => RequestHandler;
  export default morgan;
}

declare module "joi" {
  export interface ValidationErrorDetail {
    path: Array<string | number>;
    message: string;
  }

  export interface ValidationResult<T = any> {
    error?: { details: ValidationErrorDetail[] };
    value: T;
  }

  export interface Schema<T = any> {
    validate(value: T, options?: Record<string, unknown>): ValidationResult<T>;
  }

  const Joi: {
    object: () => Schema;
    string: () => Schema;
    number: () => Schema;
    boolean: () => Schema;
    array: () => Schema;
    any: () => Schema;
  };

  export default Joi;
}

declare module "axios" {
  export interface AxiosRequestConfig {
    params?: Record<string, any>;
    headers?: Record<string, string>;
    timeout?: number;
    baseURL?: string;
    url?: string;
    method?: string;
    [key: string]: any;
  }

  export interface AxiosResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    config: AxiosRequestConfig;
  }

  export interface AxiosError<T = any> extends Error {
    response?: AxiosResponse<T>;
    config?: AxiosRequestConfig;
    isAxiosError: boolean;
  }

  export interface AxiosInterceptorManager<V> {
    use(
      onFulfilled?: (value: V) => V | Promise<V>,
      onRejected?: (error: any) => any
    ): number;
    eject(id: number): void;
  }

  export interface AxiosInstance {
    interceptors: {
      request: AxiosInterceptorManager<AxiosRequestConfig>;
      response: AxiosInterceptorManager<AxiosResponse>;
    };
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
  }

  export function isAxiosError<T = any>(error: unknown): error is AxiosError<T>;

  const axios: {
    create(config?: AxiosRequestConfig): AxiosInstance;
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    isAxiosError: typeof isAxiosError;
  };

  export default axios;
}

declare module "@prisma/client" {
  export class PrismaClient {
    constructor(options?: any);
    [key: string]: any;
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    partner: any;
    connectedPage: any;
    post: any;
    pageInsight: any;
    postInsight: any;
    cmEarningsPost: any;
    cmEarningsPage: any;
    thirdPartyData: any;
    syncJob: any;
  }
}
