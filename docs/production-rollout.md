# Mission Control Production Rollout

This is the target production setup for office-wide use:

- Hosting: `Vercel`
- Database: `Neon Postgres`
- Authentication: `Microsoft Entra ID`

## 1. Create The Neon Database

1. Create a new Neon project
2. Create a database for Mission Control
3. Copy the connection string
4. Use it as `DATABASE_URL`

Expected format:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/mission_control?sslmode=require
```

## 2. Configure Microsoft Entra ID

Create an app registration in Azure:

1. Register a new application
2. Add a web redirect URI:

```text
https://YOUR-DOMAIN/api/auth/callback/azure-ad
```

3. Create a client secret
4. Capture:
   - Application (client) ID
   - Directory (tenant) ID
   - Client secret

Map those to:

```env
AUTH_ENABLED=true
NEXTAUTH_URL=https://YOUR-DOMAIN
NEXTAUTH_SECRET=long-random-secret
AZURE_AD_CLIENT_ID=...
AZURE_AD_CLIENT_SECRET=...
AZURE_AD_TENANT_ID=...
```

## 3. Configure Vercel

Set these environment variables in Vercel:

- `DATABASE_URL`
- `AUTH_ENABLED=true`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `AZURE_AD_CLIENT_ID`
- `AZURE_AD_CLIENT_SECRET`
- `AZURE_AD_TENANT_ID`
- `CLICKUP_API_KEY`
- `CLICKUP_TEAM_ID`
- optional NetSuite variables if needed

## 4. Validate Production Environment

Before first launch, run:

```bash
npm run check:prod-env
```

This verifies:

- required environment variables are present
- `DATABASE_URL` points to Postgres
- auth variables exist when auth is enabled

## 5. Apply Database Schema

For first production rollout:

```bash
npm run db:migrate:deploy
```

If you are still iterating before formal migrations are established:

```bash
npm run db:push
```

For office production, prefer migrations over repeated `db push`.

## 6. Verify Health

After deployment:

```text
GET /api/health
```

Expected result:

```json
{
  "ok": true,
  "service": "mission-control",
  "database": "ok"
}
```

## 7. Office Rollout Sequence

Recommended rollout:

1. Deploy staging
2. Confirm sign-in works with Entra ID
3. Confirm `/api/health`
4. Smoke test:
   - Capacity Grid
   - Consultant Utilization
   - Editable Tasks
   - sidebar board management
5. Pilot with a small office group
6. Open to the full office

## 8. Next Production Improvements

After the first rollout:

1. Add ClickUp background sync instead of broad live fetches on every page render
2. Add role-based permissions
3. Add Sentry
4. Add DB backups and restore checks
