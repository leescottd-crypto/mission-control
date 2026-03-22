import "server-only";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface NetSuiteConfig {
    accountId: string;
    realm: string;
    baseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
    healthPath: string;
}

export interface NetSuiteConfigValidation {
    config: NetSuiteConfig | null;
    missing: string[];
}

export interface NetSuiteConsultantRecord {
    externalId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    isInactive: boolean;
}

export interface NetSuiteConsultantSyncResult {
    ok: boolean;
    status: number;
    sourcePath: string;
    fetched: number;
    created: number;
    updated: number;
    skippedInactive: number;
    skippedInvalid: number;
    dryRun: boolean;
    missing?: string[];
    message?: string;
    consultants?: NetSuiteConsultantRecord[];
}

function percentEncode(value: string): string {
    return encodeURIComponent(value)
        .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthParams(config: NetSuiteConfig): Record<string, string> {
    return {
        oauth_consumer_key: config.consumerKey,
        oauth_token: config.tokenId,
        oauth_signature_method: "HMAC-SHA256",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: crypto.randomBytes(16).toString("hex"),
        oauth_version: "1.0",
    };
}

function normalizeParams(url: URL, oauthParams: Record<string, string>): string {
    const pairs: Array<[string, string]> = [];

    url.searchParams.forEach((value, key) => {
        pairs.push([percentEncode(key), percentEncode(value)]);
    });

    Object.entries(oauthParams).forEach(([key, value]) => {
        pairs.push([percentEncode(key), percentEncode(value)]);
    });

    pairs.sort((a, b) => {
        if (a[0] === b[0]) return a[1].localeCompare(b[1]);
        return a[0].localeCompare(b[0]);
    });

    return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function buildSignatureBaseString(method: string, url: URL, normalizedParams: string): string {
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    return [
        method.toUpperCase(),
        percentEncode(baseUrl),
        percentEncode(normalizedParams),
    ].join("&");
}

function buildAuthorizationHeader(
    config: NetSuiteConfig,
    oauthParams: Record<string, string>,
    signature: string
): string {
    const headerParams: Array<[string, string]> = [
        ["realm", config.realm],
        ...Object.entries({ ...oauthParams, oauth_signature: signature }),
    ];

    return `OAuth ${headerParams
        .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
        .join(", ")}`;
}

function sanitizeBaseUrl(rawBaseUrl: string): string {
    const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
}

function buildBaseUrl(accountId: string, baseUrl?: string): string {
    if (baseUrl && baseUrl.trim().length > 0) return sanitizeBaseUrl(baseUrl);
    return `https://${accountId}.suitetalk.api.netsuite.com`;
}

function normalizePath(path: string): string {
    const trimmed = String(path || "").trim();
    if (!trimmed) return "/";
    return trimmed;
}

function buildRequestUrl(config: NetSuiteConfig, path: string): URL {
    const normalizedPath = normalizePath(path);
    if (/^https?:\/\//i.test(normalizedPath)) {
        return new URL(normalizedPath);
    }
    const cleanPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    return new URL(`${config.baseUrl}${cleanPath}`);
}

function normalizeString(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizeLowercaseEmail(value: unknown): string {
    return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    const normalized = normalizeString(value).toLowerCase();
    return normalized === "true" || normalized === "t" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
    const normalized = normalizeString(fullName);
    if (!normalized) return { firstName: "", lastName: "" };
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
        return { firstName: normalized, lastName: "" };
    }
    return {
        firstName: tokens.slice(0, -1).join(" "),
        lastName: tokens.slice(-1).join(" "),
    };
}

function buildFullName(firstName: string, lastName: string): string {
    return `${normalizeString(firstName)} ${normalizeString(lastName)}`.trim();
}

function getNetSuiteItems(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.employees)) return payload.employees;
    if (Array.isArray(payload?.data?.items)) return payload.data.items;
    if (Array.isArray(payload?.data?.results)) return payload.data.results;
    return [];
}

function getNetSuiteNextLink(payload: any): string | null {
    const links = Array.isArray(payload?.links)
        ? payload.links
        : Array.isArray(payload?.data?.links)
        ? payload.data.links
        : [];
    const nextLink = links.find((link: any) => normalizeString(link?.rel).toLowerCase() === "next");
    const href = normalizeString(nextLink?.href);
    return href || null;
}

function normalizeNetSuiteConsultant(record: any): NetSuiteConsultantRecord | null {
    const externalId = normalizeString(
        record?.id ??
        record?.internalId ??
        record?.employeeId ??
        record?.entityId
    );
    const email = normalizeLowercaseEmail(
        record?.email ??
        record?.emailAddress
    );

    let firstName = normalizeString(
        record?.firstName ??
        record?.firstname ??
        record?.givenName
    );
    let lastName = normalizeString(
        record?.lastName ??
        record?.lastname ??
        record?.surname ??
        record?.familyName
    );
    const fullName = normalizeString(
        record?.entityId ??
        record?.entityid ??
        record?.name ??
        record?.fullName ??
        buildFullName(firstName, lastName)
    );

    if ((!firstName || !lastName) && fullName) {
        const split = splitFullName(fullName);
        if (!firstName) firstName = split.firstName;
        if (!lastName) lastName = split.lastName;
    }

    const resolvedFullName = buildFullName(firstName, lastName) || fullName;
    const isInactive = normalizeBoolean(
        record?.isInactive ??
        record?.isinactive ??
        record?.inactive
    );

    if (!externalId || !email || !resolvedFullName) return null;

    return {
        externalId,
        firstName: firstName || resolvedFullName,
        lastName,
        fullName: resolvedFullName,
        email,
        isInactive,
    };
}

async function getNextNegativeConsultantId(): Promise<number> {
    const existing = await prisma.consultant.findFirst({
        orderBy: {
            id: "asc",
        },
        select: {
            id: true,
        },
    });

    if (!existing || Number(existing.id) >= 0) return -1;
    return Number(existing.id) - 1;
}

export function getNetSuiteConsultantPathFromEnv(): string {
    return normalizePath(
        process.env.NETSUITE_CONSULTANT_PATH ||
        "/services/rest/record/v1/employee?limit=1000"
    );
}

export function getNetSuiteConfigFromEnv(): NetSuiteConfigValidation {
    const accountId = String(process.env.NETSUITE_ACCOUNT_ID || "").trim();
    const consumerKey = String(process.env.NETSUITE_CONSUMER_KEY || "").trim();
    const consumerSecret = String(process.env.NETSUITE_CONSUMER_SECRET || "").trim();
    const tokenId = String(process.env.NETSUITE_TOKEN_ID || "").trim();
    const tokenSecret = String(process.env.NETSUITE_TOKEN_SECRET || "").trim();
    const realm = String(process.env.NETSUITE_REALM || accountId).trim();
    const healthPath = String(process.env.NETSUITE_HEALTH_PATH || "/services/rest/record/v1/metadata-catalog?limit=1").trim();

    const missing: string[] = [];
    if (!accountId) missing.push("NETSUITE_ACCOUNT_ID");
    if (!consumerKey) missing.push("NETSUITE_CONSUMER_KEY");
    if (!consumerSecret) missing.push("NETSUITE_CONSUMER_SECRET");
    if (!tokenId) missing.push("NETSUITE_TOKEN_ID");
    if (!tokenSecret) missing.push("NETSUITE_TOKEN_SECRET");

    if (missing.length > 0) return { config: null, missing };

    const config: NetSuiteConfig = {
        accountId,
        realm,
        baseUrl: buildBaseUrl(accountId, process.env.NETSUITE_BASE_URL),
        consumerKey,
        consumerSecret,
        tokenId,
        tokenSecret,
        healthPath: healthPath.startsWith("/") ? healthPath : `/${healthPath}`,
    };

    return { config, missing: [] };
}

function buildSignedRequestHeaders(config: NetSuiteConfig, method: string, url: URL): Headers {
    const oauthParams = buildOAuthParams(config);
    const normalizedParams = normalizeParams(url, oauthParams);
    const signatureBaseString = buildSignatureBaseString(method, url, normalizedParams);
    const signingKey = `${percentEncode(config.consumerSecret)}&${percentEncode(config.tokenSecret)}`;
    const signature = crypto
        .createHmac("sha256", signingKey)
        .update(signatureBaseString)
        .digest("base64");

    const headers = new Headers();
    headers.set("Authorization", buildAuthorizationHeader(config, oauthParams, signature));
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    return headers;
}

export async function netSuiteRequest(
    config: NetSuiteConfig,
    path: string,
    options?: { method?: "GET" | "POST"; body?: unknown }
): Promise<Response> {
    const method = options?.method || "GET";
    const url = buildRequestUrl(config, path);
    const headers = buildSignedRequestHeaders(config, method, url);

    const init: RequestInit = {
        method,
        headers,
        cache: "no-store",
    };

    if (options?.body !== undefined) {
        init.body = JSON.stringify(options.body);
    }

    return fetch(url.toString(), init);
}

export async function netSuiteHealthCheck() {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            message: "Missing NetSuite configuration",
            missing,
        };
    }

    try {
        const response = await netSuiteRequest(config, config.healthPath, { method: "GET" });
        const text = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            endpoint: `${config.baseUrl}${config.healthPath}`,
            bodyPreview: text.slice(0, 1000),
        };
    } catch (error: any) {
        return {
            ok: false,
            status: 500,
            endpoint: `${config.baseUrl}${config.healthPath}`,
            message: String(error?.message || "Unknown NetSuite connection error"),
        };
    }
}

export async function fetchNetSuiteConsultants(path?: string): Promise<{
    ok: boolean;
    status: number;
    sourcePath: string;
    consultants: NetSuiteConsultantRecord[];
    skippedInactive: number;
    skippedInvalid: number;
    missing?: string[];
    message?: string;
}> {
    const { config, missing } = getNetSuiteConfigFromEnv();
    const sourcePath = normalizePath(path || getNetSuiteConsultantPathFromEnv());

    if (!config) {
        return {
            ok: false,
            status: 400,
            sourcePath,
            consultants: [],
            skippedInactive: 0,
            skippedInvalid: 0,
            missing,
            message: "Missing NetSuite configuration",
        };
    }

    const consultantsByExternalId = new Map<string, NetSuiteConsultantRecord>();
    let nextPath: string | null = sourcePath;
    let pageCount = 0;
    let skippedInactive = 0;
    let skippedInvalid = 0;

    try {
        while (nextPath && pageCount < 20) {
            pageCount += 1;
            const response = await netSuiteRequest(config, nextPath, { method: "GET" });
            const text = await response.text();

            if (!response.ok) {
                return {
                    ok: false,
                    status: response.status,
                    sourcePath,
                    consultants: [],
                    skippedInactive,
                    skippedInvalid,
                    message: text.slice(0, 1000) || "NetSuite consultant fetch failed",
                };
            }

            let payload: any = null;
            try {
                payload = text ? JSON.parse(text) : null;
            } catch {
                return {
                    ok: false,
                    status: 502,
                    sourcePath,
                    consultants: [],
                    skippedInactive,
                    skippedInvalid,
                    message: "NetSuite consultant response was not valid JSON",
                };
            }

            const items = getNetSuiteItems(payload);
            items.forEach((item: any) => {
                const consultant = normalizeNetSuiteConsultant(item);
                if (!consultant) {
                    skippedInvalid += 1;
                    return;
                }
                if (consultant.isInactive) {
                    skippedInactive += 1;
                    return;
                }
                consultantsByExternalId.set(consultant.externalId, consultant);
            });

            nextPath = getNetSuiteNextLink(payload);
        }

        return {
            ok: true,
            status: 200,
            sourcePath,
            consultants: Array.from(consultantsByExternalId.values()).sort((a, b) => a.fullName.localeCompare(b.fullName)),
            skippedInactive,
            skippedInvalid,
        };
    } catch (error: any) {
        return {
            ok: false,
            status: 500,
            sourcePath,
            consultants: [],
            skippedInactive,
            skippedInvalid,
            message: String(error?.message || "Unknown NetSuite consultant sync error"),
        };
    }
}

export async function syncNetSuiteConsultants(options?: {
    path?: string;
    dryRun?: boolean;
}): Promise<NetSuiteConsultantSyncResult> {
    const dryRun = Boolean(options?.dryRun);
    const fetched = await fetchNetSuiteConsultants(options?.path);

    if (!fetched.ok) {
        return {
            ok: false,
            status: fetched.status,
            sourcePath: fetched.sourcePath,
            fetched: 0,
            created: 0,
            updated: 0,
            skippedInactive: fetched.skippedInactive,
            skippedInvalid: fetched.skippedInvalid,
            dryRun,
            missing: fetched.missing,
            message: fetched.message,
        };
    }

    const consultants = fetched.consultants;
    const externalIds = consultants.map((consultant) => consultant.externalId);
    const emails = consultants.map((consultant) => consultant.email);

    const existingByExternal = new Map<string, { id: number }>();
    const existingByEmail = new Map<string, { id: number; source: string; externalId: string | null }>();

    if (externalIds.length > 0) {
        const matches = await prisma.consultant.findMany({
            where: {
                source: "netsuite",
                externalId: {
                    in: externalIds,
                },
            },
            select: {
                id: true,
                externalId: true,
            },
        });
        matches.forEach((row) => {
            if (row.externalId) {
                existingByExternal.set(String(row.externalId), { id: Number(row.id) });
            }
        });
    }

    if (emails.length > 0) {
        const matches = await prisma.consultant.findMany({
            where: {
                email: {
                    in: emails,
                },
            },
            select: {
                id: true,
                email: true,
                source: true,
                externalId: true,
            },
        });
        matches.forEach((row) => {
            existingByEmail.set(normalizeLowercaseEmail(row.email), {
                id: Number(row.id),
                source: String(row.source ?? "manual"),
                externalId: row.externalId ? String(row.externalId) : null,
            });
        });
    }

    let created = 0;
    let updated = 0;
    let nextNegativeId = await getNextNegativeConsultantId();

    for (const consultant of consultants) {
        const existingExternal = existingByExternal.get(consultant.externalId);
        const existingEmail = existingByEmail.get(consultant.email);
        const targetId = existingExternal?.id ?? existingEmail?.id ?? null;
        const data = {
            firstName: consultant.firstName,
            lastName: consultant.lastName,
            email: consultant.email,
            source: "netsuite",
            externalId: consultant.externalId,
        };

        if (targetId !== null) {
            updated += 1;
            if (!dryRun) {
                await prisma.consultant.update({
                    where: { id: targetId },
                    data,
                });
            }
            existingByExternal.set(consultant.externalId, { id: targetId });
            existingByEmail.set(consultant.email, {
                id: targetId,
                source: "netsuite",
                externalId: consultant.externalId,
            });
            continue;
        }

        created += 1;
        const createdId = nextNegativeId;
        nextNegativeId -= 1;

        if (!dryRun) {
            await prisma.consultant.create({
                data: {
                    id: createdId,
                    ...data,
                },
            });
        }

        existingByExternal.set(consultant.externalId, { id: createdId });
        existingByEmail.set(consultant.email, {
            id: createdId,
            source: "netsuite",
            externalId: consultant.externalId,
        });
    }

    return {
        ok: true,
        status: 200,
        sourcePath: fetched.sourcePath,
        fetched: consultants.length,
        created,
        updated,
        skippedInactive: fetched.skippedInactive,
        skippedInvalid: fetched.skippedInvalid,
        dryRun,
        consultants: dryRun ? consultants : undefined,
    };
}
