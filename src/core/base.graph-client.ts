import axios, { type AxiosInstance } from "axios";
import { Environment } from "../config/environment";
import { logOutboundCall } from "../middleware/apiTelemetry";

export abstract class BaseGraphClient {
  protected readonly http: AxiosInstance;
  protected readonly baseUrl: string;

  protected constructor(baseUrl: string = Environment.facebookGraphBaseUrl) {
    this.baseUrl = baseUrl;
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
    });

    // ── Telemetry: track every outbound Facebook Graph API call ──────────────
    this.http.interceptors.request.use((config) => {
      (config as unknown as Record<string, unknown>)._telemetryStart = Date.now();
      return config;
    });

    this.http.interceptors.response.use(
      (response) => {
        const start = (response.config as unknown as Record<string, unknown>)._telemetryStart as number | undefined;
        let responseBody = undefined;
        if (response.data) {
           try {
               responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
               if (responseBody.length > 50 * 1024) responseBody = responseBody.substring(0, 50 * 1024) + "... [truncated]";
           } catch(e) {}
        }
        logOutboundCall({
          timestamp: new Date().toISOString(),
          service: "Facebook Graph API",
          method: (response.config.method || "GET").toUpperCase(),
          url: response.config.url || baseUrl,
          statusCode: response.status,
          durationMs: start ? Date.now() - start : 0,
          responseBody
        });
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error)) {
          const config = (error.config as unknown as Record<string, unknown> | undefined);
          const start = config?._telemetryStart as number | undefined;
          let responseBody = undefined;
          if (error.response?.data) {
             try {
                 responseBody = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
                 if (responseBody.length > 50 * 1024) responseBody = responseBody.substring(0, 50 * 1024) + "... [truncated]";
             } catch(e) {}
          }
          logOutboundCall({
            timestamp: new Date().toISOString(),
            service: "Facebook Graph API",
            method: (error.config?.method || "GET").toUpperCase(),
            url: error.config?.url || baseUrl,
            statusCode: error.response?.status || 0,
            durationMs: start ? Date.now() - start : 0,
            error: error.message,
            responseBody
          });
        }
        return Promise.reject(error);
      }

    );
  }

  protected extractMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const apiError = error.response?.data as
        | { error?: { message?: string } }
        | Record<string, unknown>
        | undefined;

      if (apiError && typeof apiError === "object" && "error" in apiError) {
        return (apiError as { error?: { message?: string } }).error?.message || JSON.stringify(apiError);
      }

      return error.message;
    }

    return error instanceof Error ? error.message : String(error);
  }

  protected async get<T>(path: string, params: Record<string, unknown>): Promise<T> {
    const response = await this.http.get<T>(path, { params });
    return response.data;
  }

  protected async post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const response = await this.http.post<T>(path, body, { headers });
    return response.data;
  }
}
