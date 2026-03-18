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

## Health Check

Use:

```bash
GET /api/health
```

The endpoint verifies that the app can reach the database.

## Production Recommendation

For office-wide use, deploy with:

1. `Vercel` for the web app
2. `Postgres` for the database
3. environment variables managed in the hosting platform
4. uptime monitoring against `/api/health`

SQLite is fine for local development, but not the right long-term choice for a multi-user office deployment.

## Productionization Roadmap

### Immediate

1. Move `DATABASE_URL` from SQLite to managed Postgres
2. Keep Prisma query logging disabled in production
3. Deploy a shared production environment

### Next

1. Add office authentication using Google Workspace or Microsoft Entra ID
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
