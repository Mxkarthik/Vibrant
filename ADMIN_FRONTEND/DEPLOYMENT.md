# VIBRANT Admin Frontend Deployment

This guide deploys only `ADMIN_FRONTEND` to Vercel. The API remains on Render at
`https://vibrant-qkl1.onrender.com`; do not redeploy the backend as part of this
process.

## Vercel project settings

Configure the Vercel project as follows:

- **Framework Preset:** Vite
- **Root Directory:** `ADMIN_FRONTEND`
- **Install Command:** `npm ci`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Node.js Version:** 24.x (the local production build is tested with Node.js
  24.16.0; use the same major version for reproducible builds)

Set this environment variable for the **Production** environment in
**Project Settings → Environment Variables**:

```env
VITE_API_BASE_URL=https://vibrant-qkl1.onrender.com
```

Set the same variable for Preview deployments if they need to connect to the
production API. This is public frontend configuration, not a secret. Do not put
credentials, tokens, or server secrets in any `VITE_*` variable.

The local `.env.example` intentionally points to `http://localhost:5000` for
local development. Vite fails a production build if `VITE_API_BASE_URL` is
missing; it does not substitute localhost in a production bundle. The API
client normalizes trailing slashes and an optional `/api` suffix, then applies
the existing `/api` prefix once.

## SPA routing

`vercel.json` sets the Vite build/output settings and rewrites frontend paths to
`index.html`, so direct navigation and refreshes on React Router routes work.
The rewrite only handles requests made to the Vercel frontend; API requests use
the Render origin directly and are not proxied through Vercel.

## Render CORS and authentication prerequisites

Before using the new Vercel domain, configure the existing Render service:

1. Set `ADMIN_FRONTEND_URL` to a comma-separated list containing the canonical
   production Vercel URL and any existing approved admin origins, with no
   trailing slashes (for example,
   `https://your-admin-project.vercel.app,https://vibrant-orcin.vercel.app`).
   Put the canonical production URL first: `authRoutes` uses the first URL as
   the OAuth success/failure redirect target, while `server.js` adds every
   configured URL to the CORS allowlist.
2. Keep `PARTICIPANT_FRONTEND_URL` configured with its existing value. The
   backend combines admin and participant origins; do not replace the
   participant origin while adding the admin origin.
3. If Preview deployments need API access, add only the exact approved Preview
   origins to the comma-separated `ADMIN_FRONTEND_URL` value. Avoid wildcard or
   unrestricted origins. Prefer testing with a non-production backend when
   possible; updating the first URL changes the OAuth redirect target.
4. Confirm Render retains `AUTH_COOKIE_SAME_SITE=none` (or its production
   default) and secure cookies. The frontend already sends credentialed requests
   for the backend's HTTP-only session cookie.
5. In Google OAuth client settings, ensure the authorized redirect URI remains
   `https://vibrant-qkl1.onrender.com/api/auth/google/callback`. If the Google
   client configuration has authorized JavaScript origins, add the canonical
   Vercel frontend origin there as well.

These are manual Render/Google configuration steps. No backend setting is
changed by this frontend deployment. CORS is origin-based; the backend remains
responsible for authentication and administrator authorization.

## Dependency security follow-up

The readiness check's `npm audit` reported six moderate/high findings. The
locked React Router version is 6.30.6; the audit includes an open-redirect
advisory and currently offers a fix through the major React Router 7.18.5
upgrade. It also reports high-severity Vite/picomatch dependency findings
(Vite 6.4.6). No dependency upgrade was applied because the router fix is a
major-version change and could affect the existing dashboard. Review and
resolve these advisories, then rerun the production build and smoke tests,
before treating the release as security-cleared.

## Preview and production verification

1. Create a Vercel Preview deployment and verify the login page, logo/branding,
   styles, and direct loading of an internal route.
2. Verify requests use `https://vibrant-qkl1.onrender.com/api/...` and do not
   produce duplicated `/api/api` paths. Check the browser console/network panel
   for CORS errors. A 401 from an unauthenticated admin endpoint is expected.
3. Verify OAuth, session restoration, protected-route behavior, administrator
   access, and logout using an authorized test account. Do not use mutating
   production workflows for deployment checks.
4. After confirming the Preview, promote/deploy the same source revision to
   Production and repeat the read-only smoke tests.

The build is `tsc -b && vite build`; Preview serves the generated `dist`
application. Run these commands from `ADMIN_FRONTEND`:

```powershell
npm ci
$env:VITE_API_BASE_URL = "https://vibrant-qkl1.onrender.com"
npm run build
npm run preview
```

## Rollback

Use Vercel's Deployments page to promote the last known-good deployment back to
Production. If the issue is the Render allowlist or OAuth redirect, restore the
previous `ADMIN_FRONTEND_URL` and preserve the participant origin, then redeploy
the frontend only if its source/configuration also needs rollback. Do not
rollback or redeploy the Render backend as an automatic response to a frontend
rollback.
