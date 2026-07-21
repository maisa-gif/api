# api

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Copy `.env.example` to `.env`, point `DATABASE_URL` at a Postgres database (a local one is fine for development — see below), fill in any integration credentials you need, then apply the database schema:

```bash
cp .env.example .env
npx prisma migrate dev
```

Needs a Postgres instance reachable at `DATABASE_URL`. For local development, either run one with Docker:

```bash
docker run --name api-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=api_dev -p 5432:5432 -d postgres:16
```

or point it at a free hosted instance (Vercel Postgres, [Neon](https://neon.tech), [Supabase](https://supabase.com)).

On Vercel, `npm install` runs on every deploy, which triggers the `postinstall` script (`prisma generate && prisma migrate deploy`) — so as long as `DATABASE_URL` is set in the project's environment variables, new migrations are applied automatically on deploy with no manual step.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Integrations

External API integrations (settings toggle, stored credentials, API client) live under `src/lib/integrations/`:

- `src/lib/integrations/types.ts` — the `IntegrationType` union; add a new key here for each integration.
- `src/lib/integrations/registry.ts` — display metadata (name, description, docs URL, credential labels/env var names) per integration.
- `src/lib/integrations/<integration>/config.ts` — reads the integration's `client_id`/`client_secret` from environment variables (never stored in the DB).
- `src/lib/integrations/<integration>/client.ts` — the API client used to actually call the external service.
- `src/lib/integrations/service.ts` — reads/writes the `Integration` DB row (enabled flag + per-account token/hash) and merges it with env-provided credentials.

The settings UI at `/settings/integrations` (`src/app/settings/integrations/page.tsx`) renders one card per registry entry via `src/components/integrations/IntegrationCard.tsx`, backed by `GET/PATCH /api/integrations/[type]`.

Currently implemented: **Clínica nas Nuvens** (`CLINICA_NAS_NUVENS`) — see `.env.example` for the required environment variables. `src/lib/integrations/clinica-nas-nuvens/client.ts` is confirmed against the real API (discovered via its unauthenticated `/v2/api-docs` Swagger spec and live test calls): there's no OAuth2 token exchange, every request authenticates with HTTP Basic auth (`client_id`/`client_secret`) plus the `clinicaNasNuvens-cid` header, `GET /agenda/lista` requires ISO (`yyyy-MM-dd`) `dataInicial`/`dataFinal` and paginates, and patient names come from a follow-up `GET /agenda/{id}/resumida` call per appointment (not present on the list response).

To add a new integration: add its key to `types.ts`, an entry in `registry.ts`, a `config.ts`/`client.ts` pair, and a migration if it needs extra fields beyond `enabled`/`token`.

### Google Agenda sync

The Clínica nas Nuvens agenda is synced one-way (CNN → Google) into a connected Google Calendar:

- `src/lib/integrations/google-calendar/` — OAuth flow (`oauth.ts`), token persistence (`connection.ts`, reusing the same `Integration` table but with `accessToken`/`refreshToken`/`tokenExpiresAt` instead of the static `token` field), and the Calendar API client (`client.ts`). This integration doesn't go through the generic `registry.ts`/`IntegrationCard` pattern — it needs a consent redirect, not a static credential form — so it has its own routes and its own card (`GoogleCalendarCard.tsx`).
- `src/app/api/integrations/google-calendar/connect` — redirects to Google's OAuth consent screen.
- `src/app/api/integrations/google-calendar/callback` — exchanges the code for tokens and stores them.
- `src/app/api/integrations/google-calendar/disconnect` — clears the stored tokens.
- `src/lib/sync/clinica-nas-nuvens-google-calendar.ts` — fetches upcoming CNN appointments and creates/updates matching Google Calendar events, tracked via the `SyncedAppointment` table so re-runs update instead of duplicating. Does not yet delete Google events for appointments cancelled in CNN (see the note in that file). Set `CLINICA_NAS_NUVENS_EXECUTOR_ID` to restrict the sync to one professional (CNN's `idPessoaExecutor`, found via `GET /executor-agenda/lista`) — leave unset to sync every professional's appointments.
- `src/app/api/cron/sync-agenda` — runs the sync above. Protected by a shared `CRON_SECRET` (checked as `Authorization: Bearer $CRON_SECRET`). `vercel.json` schedules it once a day (`0 0 * * *`) via Vercel Cron — the Hobby plan caps cron frequency at once/day; a Pro plan (or a self-hosted scheduler sending the same header) can run it more often.

#### Setting up Google OAuth credentials

You need a Google Cloud OAuth client to connect a Google Calendar account:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. **APIs & Services → Library**: enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: configure it (External or Internal depending on your Google Workspace setup) and add your account as a test user if the app stays in "Testing" mode.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, type **Web application**.
5. Add an **Authorized redirect URI**: `{APP_URL}/api/integrations/google-calendar/callback` (e.g. `http://localhost:3000/api/integrations/google-calendar/callback` for local dev, or your production URL).
6. Copy the generated **Client ID** and **Client secret** into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, set `APP_URL` to match the redirect URI's origin, and set `CRON_SECRET` to any random string (and configure it as an env var on Vercel so Vercel Cron picks it up automatically).
7. Open `/settings/integrations` and click **Conectar com Google**.

### Meeting transcripts sync (Drive → Bitrix24)

When "Take notes with Gemini" is used on a Google Meet call, Google Drive gets a Doc named after the meeting title (== the patient's name, since the synced Calendar event is titled that way), e.g. "Victor Cirne Carvalho – 2026/07/21 15:51 GMT-03:00 – Anotações do Gemini". This pushes each new one onto the matching patient's Bitrix24 CRM timeline:

- `src/lib/integrations/google-drive/client.ts` — lists files matching the Gemini-notes naming pattern and downloads them (exporting Google Docs to PDF). Reuses the same Google OAuth connection as Calendar — the OAuth scope list in `google-calendar/oauth.ts` now also requests `drive.readonly` (broad, since these files are created by Meet, not by this app, so the narrower `drive.file` scope wouldn't see them). **Reconnect Google** (disconnect + "Conectar com Google" again) after this scope was added, or the Drive calls will fail with an insufficient-scope error.
- `src/lib/integrations/bitrix/` — Bitrix24 REST client via an inbound webhook (`BITRIX_WEBHOOK_URL`), no OAuth. Needs the **crm** permission scope on the webhook. `findContactsByPhone()`/`findContactsByName()` are confirmed working against a real portal.
- `src/lib/sync/drive-transcripts-bitrix.ts` — the sync: parses the patient name + appointment date from the Drive file name (`parseGeminiFileName`), looks up the matching CNN appointment for that patient/date to get their phone number, and searches Bitrix by phone (falling back to name matching if no CNN appointment or phone match is found). Attaches the file to the matched contact's CRM timeline via `crm.timeline.comment.add`. Tracked via the `SyncedTranscript` table (one row per Drive file — `synced`, `no_match`, `ambiguous`, or `error`, with a diagnostic note in `errorMessage`) so files aren't reprocessed; `error`/`no_match` rows are retried on the next run, `ambiguous`/`synced` are left alone. Files that aren't patient consultations (internal team meetings also using Gemini notes) correctly end up `no_match`/`ambiguous` and are never sent anywhere.
- `src/app/api/cron/sync-transcripts` — runs the sync above, same `CRON_SECRET` protection, scheduled daily via `vercel.json` (offset 30 minutes after the agenda sync).

Linking the transcript on the CNN patient's prontuário itself was explored but dropped: the CNN API has no document/attachment endpoint, and the closest workaround (writing to the appointment's `observações` via `PUT /agenda/{id}`) requires a `idPacienteConvenio` (insurance plan) value the API treats as required but that isn't available anywhere in the data this app already has — inferring/guessing an insurance plan ID to satisfy that felt like the wrong kind of write to make on a real medical record without a human decision, so this stays Bitrix-only for now.

#### Setting up the Bitrix24 webhook

1. In Bitrix24, go to **Applications → Webhooks → Inbound webhook** (or search "Webhooks" in the admin panel).
2. Grant at least the **crm** permission scope.
3. Copy the generated URL (looks like `https://yourcompany.bitrix24.com.br/rest/1/xxxxxxxxxxxxxxxx/`) into `.env`/Vercel as `BITRIX_WEBHOOK_URL`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

<!-- Deployed via Vercel's GitHub integration. -->
