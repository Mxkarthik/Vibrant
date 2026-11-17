import axios from "axios";

const apiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

export const api = axios.create({
  baseURL: `${apiBase}/api`,
  withCredentials: true,
  headers: { Accept: "application/json" },
});
