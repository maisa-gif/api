# api

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Copy `.env.example` to `.env` and fill in any integration credentials you need, then apply the database schema:

```bash
cp .env.example .env
npx prisma migrate dev
```

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

Currently implemented: **Clínica nas Nuvens** (`CLINICA_NAS_NUVENS`) — see `.env.example` for the required environment variables. The exact token endpoint/paths in `src/lib/integrations/clinica-nas-nuvens/client.ts` are a best-effort scaffold (automated docs lookup was blocked) and should be verified against https://api.clinicanasnuvens.com.br before production use.

To add a new integration: add its key to `types.ts`, an entry in `registry.ts`, a `config.ts`/`client.ts` pair, and a migration if it needs extra fields beyond `enabled`/`token`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
