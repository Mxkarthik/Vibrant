import axios from "axios";

/**
 * Normalizes the API base origin.
 * In development, defaults to http://localhost:5000 if VITE_API_BASE_URL is not set.
 * In production builds, defaults to https://vibrant-qkl1.onrender.com if VITE_API_BASE_URL is not set.
 * Removes any trailing slashes and avoids duplicate /api paths.
 */
const configuredBase = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? "https://vibrant-qkl1.onrender.com" : "http://localhost:5000")
).trim();

// Strip any trailing slashes, then strip any trailing "/api"
export const API_ORIGIN = configuredBase.replace(/\/+$/, "").replace(/\/api$/, "");

// Standard API base URL ending with /api (without trailing slash)
export const API_BASE_URL = `${API_ORIGIN}/api`;

// Dedicated Google OAuth initiation URL for participant authentication
export const GOOGLE_AUTH_PARTICIPANT_URL = `${API_BASE_URL}/auth/google/participant`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { Accept: "application/json" },
});
