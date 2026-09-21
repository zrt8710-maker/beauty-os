# Beauty OS Web beta deployment

> Deployment target changed to EdgeOne Makers. Use [DEPLOY_EDGEONE_BETA.md](DEPLOY_EDGEONE_BETA.md) for this release. The Vercel instructions and 180-second limit below are historical, not current EdgeOne settings.

Local verification for this change: `pnpm typecheck` passed; `pnpm test` 1376 passed / 43 skipped; `pnpm build` passed. `pnpm lint` retains only 13 test-fixture errors and 9 warnings, with the two business component errors resolved. A fresh `next start --port 3105` passed all 10 local HTTP smoke checks (`output/web-beta-local-smoke.json`). The built generation route trace includes both runtime knowledge documents, and the functions manifest records the 180-second limit. Actual Vercel installation/build and live mail/session/database/core-flow checks remain unverified: no authenticated Vercel CLI, project link or Vercel token was available. These local results are not an online acceptance.

## Current auth and minimal change

`/login` → `sendMagicLink` → Supabase `signInWithOtp({ shouldCreateUser: true, emailRedirectTo })` → email → `/auth/callback` → `exchangeCodeForSession` → signed session → existing onboarded user `/app`, new/incomplete user `/profile`.

Browser/server clients: `src/lib/supabase/client.ts`, `server.ts`. Proxy refreshes cookies and protects `/app`; the authenticated route-group layout protects Inventory/Profile/Today and other app pages. Logout calls Supabase `signOut` then redirects to `/login`.

The retired `AUTH_ALLOWED_EMAIL` is now ignored centrally, including stale deployed values. Login action, callback and session reader therefore accept any valid email. Generic helper allowlist parameters remain for compatibility but are not configured by the app. The unused Email OTP helper is not a live login path. Signup still requires Supabase Dashboard signup to be enabled.

## Vercel deployment

Use the existing Next.js project, Production environment, Node.js 22, the committed pnpm version and lockfile. Build command `pnpm build`; use the normal Next.js output, not static export. Enable Fluid Compute and ensure Production deployment protection permits public visitors. Configure environment variables before building. Use one stable project domain, e.g. `https://YOUR_PROJECT.vercel.app`, for all public login entry points.

The generation route exports Node runtime and `maxDuration = 180`. Planner's 75-second budget plus narration's 30 seconds needs additional database/network headroom. Vercel currently supports up to 300 seconds on Hobby with Fluid Compute; the actual project setting must be verified. Without Fluid Compute, older Hobby limits can be too short. No planner/model/prompt reduction is used. [Vercel duration documentation](https://vercel.com/docs/functions/configuring-functions/duration).

Runtime uses Supabase for durable data. Filesystem runtime reads need `docs/CARE_DECISION_GUIDANCE_V0.1.md` and `docs/ingredient-knowledge/INGREDIENT_KNOWLEDGE_PACK_V1.yaml`; do not exclude these from deployment. Offline import scripts use local files; production raw diagnostics are disabled. No required daemon or long-lived local process was found. In-memory caches are opportunistic per instance, not durable or distributed locks.

`.vercelignore` excludes local credentials, logs, build caches and development artifacts. It deliberately keeps runtime knowledge documents. This workspace includes substantial pre-existing uncommitted/new code: deploying an older GitHub commit would omit it. Deploy the reviewed current workspace via authenticated CLI, or first prepare a reviewed repository snapshot. No database migration is introduced by this release change.

Rollback: after a successful release, retain its immutable deployment and configuration. Promote the previous verified deployment if a later version fails; restore its environment values when rebuilding. This change needs no database rollback. There is no previous live deployment to roll back to on the first release.

## Minimal production environment

Copy values securely from the current working configuration; never paste secrets into chat or commit them. All Public values must be set before the production build. Changing them requires redeployment.

| Category | Variables | Required value/purpose |
| --- | --- | --- |
| Public / Supabase | `NEXT_PUBLIC_SUPABASE_URL` | Existing project HTTPS URL |
| Public / Supabase | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing public publishable/compatible anon key; code uses this exact variable name |
| Public | `NEXT_PUBLIC_APP_URL` | `https://YOUR_PROJECT.vercel.app`, or stable custom HTTPS domain; never localhost in deployment |
| Server-only / Supabase | `SUPABASE_SERVICE_ROLE_KEY` | Existing project's privileged server credential; never a NEXT_PUBLIC variable |
| Server-only / AI provider | `VOLCENGINE_AGENT_PLAN_KEY`, `VOLCENGINE_AGENT_PLAN_MODEL`, `VOLCENGINE_AGENT_PLAN_BASE_URL` | Preserve current working values; shared Planner, narration, conversations and research provider |
| Server-only / AI provider | `BAILIAN_API_KEY`, `BAILIAN_MODEL` | Preserve if using current image recognition; omitting them reduces recognition capability |
| Optional | `TODAY_CARE_PLANNER_KEY`, `TODAY_CARE_PLANNER_MODEL`, `TODAY_CARE_PLANNER_BASE_URL` | Preserve any existing overrides, otherwise inherit shared provider |
| Optional | `TODAY_CARE_NARRATIVE_KEY`, `TODAY_CARE_NARRATIVE_MODEL`, `TODAY_CARE_NARRATIVE_BASE_URL` | Preserve any existing overrides, otherwise inherit Planner/shared provider |
| Optional | `SKIN_CONVERSATION_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_SKIN_CONVERSATION_MODEL`, `OPENAI_PRODUCT_RECOGNITION_MODEL`, `OPENAI_DAILY_SKIN_NARRATION_MODEL` | Only if currently selecting those providers; default conversation provider is Volcengine |
| Optional | `TODAY_CARE_PLANNER_OUTPUT_CONTRACT` | Keep current configuration; no contract change for deployment |

Do not copy `SUPABASE_TEST_*`, development credentials, or `AUTH_ALLOWED_EMAIL` to Production. Leave `OPENVIKING_MEMORY_MODE`, `OPENVIKING_BASE_URL`, `OPENVIKING_API_KEY` unset. Production must never enable `single_user_dev`; an existing production guard also disables it. Let Vercel set `NODE_ENV=production`.

## Necessary Supabase Dashboard configuration

1. Authentication → URL Configuration: Site URL = `https://YOUR_PROJECT.vercel.app`; Redirect URLs includes exactly `https://YOUR_PROJECT.vercel.app/auth/callback`. For a custom domain substitute that domain in both places and APP_URL. Keep localhost redirect only if still needed for local development. Avoid broad production redirect wildcards.
2. Authentication → signup settings: allow new users to sign up; enable Email provider. Keep email confirmation. No password UI is needed.
3. Configure custom SMTP with a verified sender. Supabase's default SMTP is restricted to project team addresses, so removing the application allowlist alone does not enable arbitrary-email delivery. Verify the provider's sending permissions and quota. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).
4. Confirm Signup and Magic Link email templates must contain the normal `{{ .ConfirmationURL }}` link. Do not leave a previous OTP-only template in place. This release uses the PKCE link/callback, not a six-digit code form. Open the email link in the same browser used to request it.

Site URL and SMTP are hosted settings, not values this repository can verify without project access. Existing schema/RLS/storage configuration must be retained; successful local builds do not establish live database access.

## Live acceptance (pending deployment and mailbox access)

- Logged out: `/app`, `/inventory`, `/profile`, `/today` redirect to login; protected APIs reject unauthenticated requests.
- New non-team email: receive real email → click link → user/session created → Profile → save → refresh → data persists.
- Existing email: log in via a fresh link and verify previous assets/profile remain.
- Logout: session gone and protected routes inaccessible.
- With an authenticated test user: asset creation, Daily Skin, Today generation and stable-condition reuse. Verify two-user data isolation. Record observed generation time separately from the configured timeout.

Do not mark these online checks passed based on mocked tests or a local Next production server.

## Deferred without expanding this release

Routine reuse and disabled generation buttons already exist. No server-side per-user generation lock or daily quota was found; parallel tabs/direct requests can still spend twice. Minimal P1: use existing Supabase to acquire a per-user expiring generation lease atomically, release on completion, return 409 for an active lease. A JavaScript Map would not protect multiple Vercel instances. No Redis/Kafka is proposed; no lease/schema change is included in this release.

Set and monitor AI provider budget alerts/limits for the public beta. The 13 test-fixture lint errors remain out of scope. WeChat mini-program is a later client: retain current domain model, Supabase data and `/api/v1` business endpoints; add a suitable mini-program authentication adapter later. Existing cookie/PKCE web login is not claimed to work unchanged in a mini-program.
