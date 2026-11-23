import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("PHASE 08.9: CONFIGURE DEPLOYED RENDER BACKEND FOR ORGANISER FRONTEND", () => {
  const rootDir = process.cwd();
  const frontendDir = path.join(rootDir, "ORGANISER_FRONTEND");

  // --------------------------------------------------------------------------
  // GROUP 1: ENVIRONMENT CONFIGURATION & VITE_API_BASE_URL
  // --------------------------------------------------------------------------
  describe("Group 1: Environment Configuration & VITE_API_BASE_URL", () => {
    it("1. .env.production specifies the exact Render backend origin", () => {
      const prodEnvPath = path.join(frontendDir, ".env.production");
      assert.ok(fs.existsSync(prodEnvPath), ".env.production file must exist");

      const prodEnvContent = fs.readFileSync(prodEnvPath, "utf-8");
      assert.match(
        prodEnvContent,
        /^VITE_API_BASE_URL\s*=\s*https:\/\/vibrant-qkl1\.onrender\.com\s*$/m,
        "VITE_API_BASE_URL must match https://vibrant-qkl1.onrender.com"
      );
    });

    it("2. .env.example defines safe localhost default for local development", () => {
      const exampleEnvPath = path.join(frontendDir, ".env.example");
      assert.ok(fs.existsSync(exampleEnvPath), ".env.example file must exist");

      const exampleContent = fs.readFileSync(exampleEnvPath, "utf-8");
      assert.match(
        exampleContent,
        /^VITE_API_BASE_URL\s*=\s*http:\/\/localhost:5000\s*$/m,
        "Example must provide safe localhost:5000 default"
      );
      assert.ok(
        exampleContent.includes("https://vibrant-qkl1.onrender.com"),
        "Example must document the production Render backend URL"
      );
    });

    it("3. No secrets, private keys, or database URIs are contained in env files", () => {
      const prodEnvContent = fs.readFileSync(path.join(frontendDir, ".env.production"), "utf-8");
      const exampleContent = fs.readFileSync(path.join(frontendDir, ".env.example"), "utf-8");

      for (const forbidden of ["mongodb", "JWT_SECRET", "SESSION_SECRET", "GOOGLE_CLIENT_SECRET", "CLOUDINARY"]) {
        assert.ok(!prodEnvContent.includes(forbidden), `.env.production must not contain ${forbidden}`);
        assert.ok(!exampleContent.includes(forbidden), `.env.example must not contain ${forbidden}`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: AXIOS BASE URL RESOLUTION & /api DE-DUPLICATION
  // --------------------------------------------------------------------------
  describe("Group 2: Axios Base URL Resolution & /api De-duplication", () => {
    it("4. client.ts normalizes API origin and prevents duplicated /api prefixes", () => {
      const clientSrc = fs.readFileSync(path.join(frontendDir, "src/api/client.ts"), "utf-8");

      assert.ok(
        clientSrc.includes(".replace(/\\/+$/, \"\").replace(/\\/api$/i, \"\")"),
        "client.ts strips trailing slashes and /api to normalize origin"
      );
      assert.ok(
        clientSrc.includes("export const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : \"/api\";"),
        "client.ts defines API_BASE_URL with single /api postfix"
      );
    });

    it("5. Axios client uses API_BASE_URL and withCredentials: true for cross-origin cookies", () => {
      const clientSrc = fs.readFileSync(path.join(frontendDir, "src/api/client.ts"), "utf-8");

      assert.ok(clientSrc.includes("baseURL: API_BASE_URL"), "Axios client configures baseURL: API_BASE_URL");
      assert.ok(clientSrc.includes("withCredentials: true"), "Axios client configures withCredentials: true");
    });

    it("6. Runtime origin calculation correctly resolves URL with no /api duplication", () => {
      // Emulate client.ts resolution logic
      function resolveApiUrl(rawInput, endpointPath) {
        const configuredBase = rawInput.trim();
        const apiOrigin = configuredBase
          ? configuredBase.replace(/\/+$/, "").replace(/\/api$/i, "")
          : "";
        const apiBaseUrl = apiOrigin ? `${apiOrigin}/api` : "/api";
        const cleanEndpoint = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
        return `${apiBaseUrl}${cleanEndpoint}`;
      }

      const inputVariations = [
        "https://vibrant-qkl1.onrender.com",
        "https://vibrant-qkl1.onrender.com/",
        "https://vibrant-qkl1.onrender.com/api",
        "https://vibrant-qkl1.onrender.com/api/",
      ];

      for (const input of inputVariations) {
        const resolved = resolveApiUrl(input, "/registrations/attendance");
        assert.equal(
          resolved,
          "https://vibrant-qkl1.onrender.com/api/registrations/attendance",
          `Input "${input}" must resolve without duplicate /api`
        );
        assert.ok(!resolved.includes("/api/api/"), `Resolved URL "${resolved}" must never contain /api/api/`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: ACTUAL BACKEND ENDPOINTS & COMPATIBILITY VERIFICATION
  // --------------------------------------------------------------------------
  describe("Group 3: Actual Backend Endpoints & Compatibility Verification", () => {
    it("7. Authentication session endpoint resolves to GET /api/auth/me", () => {
      const authServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/authService.ts"), "utf-8");
      assert.ok(
        authServiceSrc.includes('api.get<{ success: true; user: CurrentUser }>("/auth/me")'),
        "fetchCurrentUser calls GET /auth/me relative to Axios baseURL"
      );

      const authRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/authRoutes.js"), "utf-8");
      assert.ok(authRoutesSrc.includes('router.get("/me"'), "Backend defines GET /me under /api/auth mount");
    });

    it("8. Google Organiser OAuth endpoint resolves to GET /api/auth/google/organiser", () => {
      const authServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/authService.ts"), "utf-8");
      assert.ok(
        authServiceSrc.includes("return `${API_BASE_URL}/auth/google/organiser`;"),
        "getGoogleAuthUrl generates full OAuth URL with API_BASE_URL"
      );

      const authRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/authRoutes.js"), "utf-8");
      assert.ok(
        authRoutesSrc.includes('router.get("/google/organiser"'),
        "Backend defines GET /google/organiser under /api/auth mount"
      );
    });

    it("9. QR attendance check-in resolves to POST /api/registrations/attendance", () => {
      const attendanceServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/attendanceService.ts"), "utf-8");
      assert.ok(
        attendanceServiceSrc.includes('api.post<MarkAttendanceResponse>("/registrations/attendance", payload)'),
        "markAttendanceCheckIn calls POST /registrations/attendance"
      );

      const registrationRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/registrationRoutes.js"), "utf-8");
      assert.match(
        registrationRoutesSrc,
        /router\.post\(\s*["']\/attendance["']/m,
        "Backend defines POST /attendance under /api/registrations mount"
      );
    });

    it("10. Registration ID manual lookup resolves to POST /api/registrations/manual-lookup", () => {
      const attendanceServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/attendanceService.ts"), "utf-8");
      assert.ok(
        attendanceServiceSrc.includes('api.post<ManualLookupResponse>("/registrations/manual-lookup", payload)'),
        "lookupRegistrationForManualCheckIn calls POST /registrations/manual-lookup"
      );

      const registrationRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/registrationRoutes.js"), "utf-8");
      assert.match(
        registrationRoutesSrc,
        /router\.post\(\s*["']\/manual-lookup["']/m,
        "Backend defines POST /manual-lookup under /api/registrations mount"
      );
    });

    it("11. Registration ID manual check-in resolves to POST /api/registrations/manual-attendance", () => {
      const attendanceServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/attendanceService.ts"), "utf-8");
      assert.ok(
        attendanceServiceSrc.includes('api.post<MarkAttendanceResponse>("/registrations/manual-attendance", payload)'),
        "markManualAttendanceCheckIn calls POST /registrations/manual-attendance"
      );

      const registrationRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/registrationRoutes.js"), "utf-8");
      assert.match(
        registrationRoutesSrc,
        /router\.post\(\s*["']\/manual-attendance["']/m,
        "Backend defines POST /manual-attendance under /api/registrations mount"
      );
    });

    it("12. Event attendance statistics resolves to GET /api/events/:id/attendance", () => {
      const attendanceServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/attendanceService.ts"), "utf-8");
      assert.ok(
        attendanceServiceSrc.includes('api.get<AttendanceReport>(`/events/${eventId}/attendance`)'),
        "getEventAttendance calls GET /events/:id/attendance"
      );

      const eventRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/eventRoutes.js"), "utf-8");
      assert.match(
        eventRoutesSrc,
        /router\.get\(\s*["']\/:id\/attendance["']/m,
        "Backend defines GET /:id/attendance under /api/events mount"
      );
    });

    it("13. Excel export endpoint resolves to GET /api/events/:id/export", () => {
      const attendanceServiceSrc = fs.readFileSync(path.join(frontendDir, "src/api/attendanceService.ts"), "utf-8");
      assert.ok(
        attendanceServiceSrc.includes('api.get<Blob>(`/events/${eventId}/export`'),
        "exportEventAttendance calls GET /events/:id/export"
      );

      const eventRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/eventRoutes.js"), "utf-8");
      assert.match(
        eventRoutesSrc,
        /router\.get\(\s*["']\/:id\/export["']/m,
        "Backend defines GET /:id/export under /api/events mount"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: PRODUCTION BUILD SAFETY, NO MOCK INTERCEPTION & NO TUNNELS
  // --------------------------------------------------------------------------
  describe("Group 4: Production Build Safety, No Mock Interception & No Tunnels", () => {
    it("14. No Mock Mode adapters or mock interceptors exist in frontend source code", () => {
      const srcFiles = [];
      function collectFiles(dir) {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            collectFiles(fullPath);
          } else if (/\.(ts|tsx|js|jsx)$/.test(item.name)) {
            srcFiles.push(fullPath);
          }
        }
      }
      collectFiles(path.join(frontendDir, "src"));

      for (const file of srcFiles) {
        const content = fs.readFileSync(file, "utf-8");
        assert.ok(!/mockMode|useMockAdapter|mockResponse/i.test(content), `File ${file} must not contain mock interceptors`);
      }
    });

    it("15. Production build bundle includes the deployed Render backend URL", () => {
      const distAssetsDir = path.join(frontendDir, "dist/assets");
      assert.ok(fs.existsSync(distAssetsDir), "dist/assets must exist");

      const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith(".js"));
      assert.ok(jsFiles.length > 0, "At least one JS bundle must exist");

      let foundRenderUrl = false;
      for (const file of jsFiles) {
        const content = fs.readFileSync(path.join(distAssetsDir, file), "utf-8");
        if (content.includes("https://vibrant-qkl1.onrender.com")) {
          foundRenderUrl = true;
          break;
        }
      }

      assert.ok(foundRenderUrl, "Production bundle must embed https://vibrant-qkl1.onrender.com");
    });

    it("16. Production build bundle contains zero localhost backend references or Cloudflare tunnels", () => {
      const distAssetsDir = path.join(frontendDir, "dist/assets");
      const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith(".js"));

      for (const file of jsFiles) {
        const content = fs.readFileSync(path.join(distAssetsDir, file), "utf-8");
        assert.ok(!content.includes("localhost:5000"), `Bundle ${file} must not contain localhost:5000`);
        assert.ok(!content.includes("trycloudflare.com"), `Bundle ${file} must not contain Cloudflare tunnel URLs`);
      }
    });
  });
});
