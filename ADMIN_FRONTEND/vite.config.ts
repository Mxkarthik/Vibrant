import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && !env.VITE_API_BASE_URL?.trim()) {
    throw new Error(
      "Missing required VITE_API_BASE_URL. Set it to the deployed backend URL before building for production."
    );
  }

  return { plugins: [react()], server: { host: "0.0.0.0" } };
});
