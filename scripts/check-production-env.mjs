const requiredAlways = [
  "DATABASE_URL",
  "CLICKUP_API_KEY",
  "CLICKUP_TEAM_ID",
];

const requiredWhenAuthEnabled = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "AZURE_AD_CLIENT_ID",
  "AZURE_AD_CLIENT_SECRET",
  "AZURE_AD_TENANT_ID",
];

function isTruthy(value) {
  return String(value || "").trim().length > 0;
}

function looksLikePostgres(url) {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("postgres://") || normalized.startsWith("postgresql://");
}

const missing = requiredAlways.filter((key) => !isTruthy(process.env[key]));
const authEnabled = String(process.env.AUTH_ENABLED || "").trim().toLowerCase() === "true";

if (authEnabled) {
  missing.push(...requiredWhenAuthEnabled.filter((key) => !isTruthy(process.env[key])));
}

const databaseUrl = process.env.DATABASE_URL || "";
const errors = [];

if (!looksLikePostgres(databaseUrl)) {
  errors.push("DATABASE_URL must point to Postgres for office production rollout.");
}

if (authEnabled && !String(process.env.NEXTAUTH_URL || "").startsWith("http")) {
  errors.push("NEXTAUTH_URL must be a valid absolute URL when AUTH_ENABLED=true.");
}

if (missing.length > 0) {
  errors.push(`Missing environment variables: ${Array.from(new Set(missing)).join(", ")}`);
}

if (errors.length > 0) {
  console.error("Mission Control production environment check failed:");
  errors.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log("Mission Control production environment check passed.");
