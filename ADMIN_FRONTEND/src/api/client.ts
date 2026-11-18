import axios from "axios";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const baseUrl = configuredBaseUrl || (import.meta.env.DEV ? "http://localhost:5000" : undefined);

if (!baseUrl) {
  throw new Error(
    "Missing required VITE_API_BASE_URL. Configure the production backend URL and rebuild the admin app."
  );
}

const apiOrigin = baseUrl
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");

export const apiBaseUrl = `${apiOrigin}/api`;

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 30_000,
  headers: { Accept: "application/json" },
});
