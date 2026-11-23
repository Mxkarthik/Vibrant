import axios from "axios";

/**
 * Normalizes the API base origin.
 * In development, defaults to http://localhost:5000 if VITE_API_BASE_URL is not set.
 * In production builds, VITE_API_BASE_URL must be configured to the deployed backend URL.
 * Strips any trailing slashes and trailing "/api" to prevent duplication.
 */
const configuredBase = (
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL
    : (typeof import.meta !== "undefined" && (import.meta.env?.DEV || !import.meta.env?.PROD) ? "http://localhost:5000" : "")
)?.trim();

// Clean origin without trailing slash or /api
export const API_ORIGIN = configuredBase
  ? configuredBase.replace(/\/+$/, "").replace(/\/api$/i, "")
  : "";

// Standard API base URL ending with /api (without trailing slash)
export const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

export function getApiErrorMessage(error: unknown, fallbackMessage: string): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || fallbackMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}
