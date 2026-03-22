# NetSuite Connection Runbook (Mission Control)

## 1) Security + Access Setup
1. Rotate any password that appeared in chat/screenshot.
2. Use a dedicated integration user (or dedicated admin seat during setup only).
3. Enforce MFA/2FA for UI login users.
4. Use least privilege for integration role.

## 2) NetSuite Feature Flags
In NetSuite, enable:
1. `Setup > Company > Enable Features > SuiteCloud`
2. `SuiteTalk (Web Services)`
3. `REST Web Services`
4. `Token-based Authentication`

## 3) Integration Record + Tokens
1. Create integration record: `Setup > Integrations > Manage Integrations > New`
2. Ensure TBA is enabled on the integration.
3. Capture:
   - `Consumer Key`
   - `Consumer Secret`
4. For integration user + role, create access token and capture:
   - `Token ID`
   - `Token Secret`
5. Capture `Account ID` (realm) from `Setup > Company > Company Information`.

## 4) Environment Variables
Add to runtime secrets (not committed):
1. `NETSUITE_ACCOUNT_ID`
2. `NETSUITE_CONSUMER_KEY`
3. `NETSUITE_CONSUMER_SECRET`
4. `NETSUITE_TOKEN_ID`
5. `NETSUITE_TOKEN_SECRET`

Optional:
1. `NETSUITE_REALM` (defaults to account id)
2. `NETSUITE_BASE_URL` (defaults to `https://<account>.suitetalk.api.netsuite.com`)
3. `NETSUITE_HEALTH_PATH` (defaults to `/services/rest/record/v1/metadata-catalog?limit=1`)
4. `NETSUITE_CONSULTANT_PATH` (defaults to `/services/rest/record/v1/employee?limit=1000`)
5. `NETSUITE_SYNC_TOKEN` (recommended to protect sync `POST`s)

## 5) Mission Control Connector (Implemented)
Implemented in this repo:
1. OAuth 1.0a (HMAC-SHA256) signer in `src/lib/netsuite.ts`
2. Health endpoint in `src/app/api/integrations/netsuite/health/route.ts`
3. Consultant sync endpoint in `src/app/api/integrations/netsuite/consultants/sync/route.ts`

## 6) Smoke Test
With app running:
1. `GET /api/integrations/netsuite/health`
2. Success criteria:
   - HTTP `200`
   - Response `{ ok: true }`
3. Failure responses:
   - `400` missing env vars
   - `401/403` auth/role issue
   - `404` wrong domain/path

Consultant sync:
1. `GET /api/integrations/netsuite/consultants/sync`
2. Confirm `missing` is empty and `consultantPath` is the expected employee endpoint.
3. `POST /api/integrations/netsuite/consultants/sync` with `{ "dryRun": true }`
4. Success criteria:
   - HTTP `200`
   - `ok: true`
   - non-zero `fetched` if the source has consultant data
5. When ready, run the same endpoint without `dryRun` to upsert consultants into Mission Control.

## 7) Troubleshooting
1. `401 INVALID_LOGIN_ATTEMPT`:
   - Wrong keys/tokens or role restrictions.
2. `403 INSUFFICIENT_PERMISSION`:
   - Role missing record/web services permissions.
3. `404`:
   - Wrong account domain or path.
4. Signature mismatch:
   - Confirm account/realm and token pair are from same account.

## 8) Production Hardening
1. Store secrets in vault/secret manager.
2. Rotate tokens regularly.
3. Add structured logging for status and response code only (never secrets).
4. Add integration health monitoring alert on repeated non-200 responses.
