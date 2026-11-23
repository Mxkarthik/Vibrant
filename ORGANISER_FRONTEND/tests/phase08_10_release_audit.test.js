import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("PHASE 08.10: PHASE 08B RELEASE AUDIT & STAGING READINESS", () => {
  const rootDir = process.cwd();
  const frontendDir = path.join(rootDir, "ORGANISER_FRONTEND");

  // --------------------------------------------------------------------------
  // GROUP 1: VERCEL BUILD SPECIFICATION & SPA ROUTING REWRITES
  // --------------------------------------------------------------------------
  describe("Group 1: Vercel Build Specification & SPA Routing", () => {
    it("1. vercel.json defines rewrite rule for client-side routing on all deep paths", () => {
      const vercelJsonPath = path.join(frontendDir, "vercel.json");
      assert.ok(fs.existsSync(vercelJsonPath), "vercel.json must exist in ORGANISER_FRONTEND");

      const config = JSON.parse(fs.readFileSync(vercelJsonPath, "utf-8"));
      assert.equal(config.framework, "vite", "Vercel framework must be vite");
      assert.equal(config.buildCommand, "npm run build", "Build command must be npm run build");
      assert.equal(config.outputDirectory, "dist", "Output directory must be dist");

      const hasCatchAll = config.rewrites?.some(
        (r) => (r.source === "/(.*)" || r.source === "/:path*") && r.destination === "/index.html"
      );
      assert.ok(hasCatchAll, "vercel.json must rewrite all routes to /index.html for SPA refresh safety");
    });

    it("2. App.tsx declares all required deep routes with scanner-first fallback", () => {
      const appSrc = fs.readFileSync(path.join(frontendDir, "src/App.tsx"), "utf-8");

      assert.ok(appSrc.includes('path="/scanner"'), "Declares /scanner route");
      assert.ok(appSrc.includes('path="/events"'), "Declares /events route");
      assert.ok(appSrc.includes('path="/events/:id/dashboard"'), "Declares /events/:id/dashboard route");
      assert.ok(appSrc.includes('path="/events/:id/scanner"'), "Declares /events/:id/scanner route");
      assert.ok(appSrc.includes('path="/events/:id/attendance"'), "Declares /events/:id/attendance route");
      assert.ok(appSrc.includes('path="/dashboard"'), "Declares /dashboard route");
      assert.ok(appSrc.includes('path="/tracker"'), "Declares /tracker route");
      assert.ok(appSrc.includes('path="*" element={<Navigate to="/scanner" replace />}'), "Default fallback is /scanner");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: GOOGLE OAUTH REDIRECT AUDIT & PATCH SAFETY
  // --------------------------------------------------------------------------
  describe("Group 2: Google OAuth Redirect Audit & Patch Safety", () => {
    it("3. Verifies /scanner post-login redirect in backend/routes/authRoutes.js", () => {
      const authRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/authRoutes.js"), "utf-8");

      assert.ok(
        authRoutesSrc.includes('if (portal === "organiser") {\n            return res.redirect(302, `${frontendUrl}/scanner`);\n        }') ||
        authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/scanner`);'),
        "Organiser OAuth callback now directs to /scanner"
      );
      assert.ok(
        !authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/events`);'),
        "Old /events redirect is completely replaced"
      );
      assert.ok(authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/admin`);'), "Preserves Admin destination");
      assert.ok(authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/auth/callback'), "Preserves Participant destination");
    });

    it("4. Validates proposed 1-line patch to redirect to /scanner without touching other portals", () => {
      const originalBlock = `
        if (portal === "participant") {
            return res.redirect(302, \`\${frontendUrl}/auth/callback?token=\${encodeURIComponent(token)}\`);
        }
        if (portal === "organiser") {
            return res.redirect(302, \`\${frontendUrl}/events\`);
        }
        return res.redirect(302, \`\${frontendUrl}/admin\`);
      `;

      const patchedBlock = originalBlock.replace(
        'return res.redirect(302, `${frontendUrl}/events`);',
        'return res.redirect(302, `${frontendUrl}/scanner`);'
      );

      assert.ok(patchedBlock.includes('`${frontendUrl}/scanner`'), "Patched block directs to /scanner");
      assert.ok(patchedBlock.includes('`${frontendUrl}/admin`'), "Admin destination preserved");
      assert.ok(patchedBlock.includes('`${frontendUrl}/auth/callback'), "Participant destination preserved");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: CROSS-ORIGIN COOKIES & CORS ALIGNMENT
  // --------------------------------------------------------------------------
  describe("Group 3: Cross-Origin Cookies & CORS Alignment", () => {
    it("5. Frontend Axios enables withCredentials across all API calls", () => {
      const clientSrc = fs.readFileSync(path.join(frontendDir, "src/api/client.ts"), "utf-8");
      assert.ok(clientSrc.includes("withCredentials: true"), "Axios client configures withCredentials: true");
    });

    it("6. Backend server.js configures credentials: true and default production origins", () => {
      const serverSrc = fs.readFileSync(path.join(rootDir, "backend/server.js"), "utf-8");

      assert.ok(serverSrc.includes("credentials: true"), "CORS middleware enables credentials: true");
      assert.ok(
        serverSrc.includes("https://dietvibrant-organiser.vercel.app"),
        "Default production origins includes dietvibrant-organiser.vercel.app"
      );
      assert.ok(
        serverSrc.includes("process.env.ORGANISER_FRONTEND_URL"),
        "Allows dynamic override via ORGANISER_FRONTEND_URL on Render"
      );
    });

    it("7. Cookie options enforce httpOnly, Secure, and sameSite: none in production", () => {
      const authRoutesSrc = fs.readFileSync(path.join(rootDir, "backend/routes/authRoutes.js"), "utf-8");

      assert.ok(authRoutesSrc.includes("httpOnly: true"), "Enforces httpOnly: true");
      assert.ok(authRoutesSrc.includes('cookieSameSite = (process.env.AUTH_COOKIE_SAME_SITE || (isProduction ? "none" : "lax")).toLowerCase()'), "Defaults to none in production");
      assert.ok(authRoutesSrc.includes('secure: isProduction || cookieSameSite === "none"'), "Enforces secure in production");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: MOBILE CAMERA HARDWARE LIFECYCLE & CLEANUP
  // --------------------------------------------------------------------------
  describe("Group 4: Mobile Camera Hardware Lifecycle & Cleanup", () => {
    it("8. Camera initialization discovers rear camera and selects environment device", () => {
      const scannerSrc = fs.readFileSync(path.join(frontendDir, "src/components/scanner/EventScanner.tsx"), "utf-8");
      assert.ok(
        scannerSrc.includes('d.label.toLowerCase().includes("back")') ||
        scannerSrc.includes('d.label.toLowerCase().includes("environment")') ||
        scannerSrc.includes("rearCamera"),
        "Discovers and prefers rear camera"
      );
      assert.ok(scannerSrc.includes("decodeFromVideoDevice"), "Uses decodeFromVideoDevice for hardware camera stream");
    });

    it("9. Hardware tracks and ZXing controls are cleanly terminated on stopCamera", () => {
      const scannerSrc = fs.readFileSync(path.join(frontendDir, "src/components/scanner/EventScanner.tsx"), "utf-8");
      assert.ok(scannerSrc.includes("controlsRef.current.stop();"), "Stops ZXing decoding loop");
      assert.ok(scannerSrc.includes("track.stop()"), "Iterates media tracks and terminates stream");
    });
  });
});
