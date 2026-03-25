# Mission Control

Mission Control is a Next.js operations dashboard for office-wide planning across:

- capacity planning
- consultant utilization
- editable weekly task boards
- client pacing
- ClickUp-backed workflow visibility

## Local Development

1. Copy `.env.template` to `.env.local`
2. Set the required environment variables
3. Install dependencies
4. Run:

```bash
npm run dev
```

The app will start on [http://localhost:3000](http://localhost:3000).

## Testing

Run the core checks:

```bash
npm run lint
npm run build
```

Run the browser smoke suite:

```bash
npm run test:smoke
```

Useful variants:

```bash
npm run test:smoke:headed
npm run test:full
```

Notes:

- `test:smoke` launches the app on `http://127.0.0.1:3100`
- it clones `dev.db` into a temporary SQLite file so the suite does not mutate your main local database
- it runs `prisma db push` against that temporary database so the smoke environment matches the current schema
- it uses an isolated `.next-smoke-*` build directory so smoke runs do not corrupt your normal `.next` cache

## Required Environment Variables

- `DATABASE_URL`
- `CLICKUP_API_KEY`
- `CLICKUP_TEAM_ID`

Optional NetSuite integration variables:

- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CONSUMER_SECRET`
- `NETSUITE_TOKEN_ID`
- `NETSUITE_TOKEN_SECRET`
- `NETSUITE_REALM`
- `NETSUITE_BASE_URL`
- `NETSUITE_HEALTH_PATH`
- `NETSUITE_CONSULTANT_PATH`
- `NETSUITE_SYNC_TOKEN`

Authentication variables for office rollout:

- `AUTH_ENABLED`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_BOOTSTRAP_ADMIN_EMAIL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Health Check

Use:

```bash
GET /api/health
```

The endpoint verifies that the app can reach the database.

## NetSuite Consultant Sync

Once NetSuite credentials are configured, you can inspect readiness with:

```bash
GET /api/integrations/netsuite/consultants/sync
```

Run a dry run:

```bash
POST /api/integrations/netsuite/consultants/sync
{
  "dryRun": true
}
```

Run a real sync:

```bash
POST /api/integrations/netsuite/consultants/sync
```

If `NETSUITE_SYNC_TOKEN` is set, send it as either:

- `Authorization: Bearer <token>`
- `x-sync-token: <token>`

## Production Recommendation

For office-wide use, deploy with:

1. `Vercel` for the web app
2. `Postgres` for the database
3. `Google Workspace / Google OAuth` for login
4. environment variables managed in the hosting platform
5. uptime monitoring against `/api/health`

SQLite is fine for local development, but not the right long-term choice for a multi-user office deployment.

## Productionization Roadmap

### Immediate

1. Move `DATABASE_URL` from SQLite to managed Postgres
2. Create your first admin user or set `AUTH_BOOTSTRAP_ADMIN_EMAIL`
3. Turn on `AUTH_ENABLED=true` once Google auth variables are configured
4. Keep Prisma query logging disabled in production
5. Deploy a shared production environment

### Next

1. Expand role-based privilege enforcement deeper across editable screens
2. Add background ClickUp sync so the UI reads from local data instead of pulling everything live
3. Add backups, monitoring, and audit tracking for office edits

## Deployment Checklist

### Before first office rollout

1. Create a Postgres database
2. Set `DATABASE_URL` in production
3. Run Prisma schema sync or migrations
4. Set ClickUp secrets
5. Verify `/api/health`
6. Test with a small pilot group before opening to the full office

See the full office rollout guide in [docs/production-rollout.md](/Users/scottlee/Antigravity/MissionControl/docs/production-rollout.md).
