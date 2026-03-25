"use server";

import { randomBytes } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { APP_ROLE_ORDER, normalizeAppRole, ROLE_DEFINITIONS, type AppRole } from "@/lib/access";
import { getInviteUrl, sendInviteEmail } from "@/lib/invite-email";
import { getTeamMembers, getTeamTasks } from "@/lib/clickup";

export interface CapacityGridResource {
    id: string;
    name: string;
    orderIndex: number;
    consultantId?: number | null;
    removed?: boolean;
    removedAt?: string | null;
}

export interface CapacityGridAllocation {
    hours: number;
    source?: "manual" | "clickup";
    note?: string;
}

export interface CapacityGridRow {
    id: string;
    team: number;
    teamSa: string;
    dealType: string;
    wkMin: number;
    wkMax: number;
    client: string;
    notes: string;
    allocations: Record<string, CapacityGridAllocation>;
}

export interface CapacityGridPayload {
    resources: CapacityGridResource[];
    rows: CapacityGridRow[];
}

export interface CapacityGridWeekRecord {
    week: string;
    payload: CapacityGridPayload;
}

export interface CapacityGridConsultant {
    id: number;
    name: string;
}

export interface ConsultantRecord {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    fullName: string;
    source: string;
    externalId?: string | null;
}

export interface ClientDirectoryRecord {
    id: string;
    name: string;
    team: number | null;
    sa: string;
    dealType: string;
    min: number | null;
    max: number | null;
    isActive: boolean;
    isInternal: boolean;
    sortOrder: number;
}

type LegacyClientDefaults = {
    name: string;
    team: number | null;
    sa: string;
    dealType: string;
    min: number | null;
    max: number | null;
    sortOrder: number;
};

type LegacyCapacityGridDefaults = {
    name: string;
    min: number | null;
    max: number | null;
};

let clickUpConsultantSyncPromise: Promise<void> | null = null;
let lastClickUpConsultantSyncAt = 0;

function pickLegacyMetricValue(current: number | null, incoming: number | null) {
    const currentValue = current == null ? null : Number(current);
    const incomingValue = incoming == null ? null : Number(incoming);

    if (currentValue != null && Number.isFinite(currentValue) && currentValue > 0) {
        return currentValue;
    }
    if (incomingValue != null && Number.isFinite(incomingValue) && incomingValue > 0) {
        return incomingValue;
    }
    if (currentValue != null && Number.isFinite(currentValue)) {
        return currentValue;
    }
    if (incomingValue != null && Number.isFinite(incomingValue)) {
        return incomingValue;
    }
    return null;
}

export interface AppUserRecord {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: AppRole;
    privileges: string[];
    status: string;
    invitedAt?: string | null;
    inviteSentAt?: string | null;
    inviteAcceptedAt?: string | null;
    lastLoginAt?: string | null;
}

export interface EditableTaskSeed {
    sourceTaskId: string;
    subject: string;
    description?: string;
    assignee?: string;
    isAi?: boolean;
    billableHoursToday?: number;
    week: string;
    status: "backlog" | "open" | "closed";
}

export interface EditableTaskRecord {
    id: string;
    week: string;
    scopeType: string;
    scopeId: string;
    sourceTaskId?: string | null;
    subject: string;
    description: string;
    assignee: string;
    isAi: boolean;
    billableHoursToday: number;
    status: "backlog" | "open" | "closed";
    position: number;
    attachments: EditableTaskAttachmentRecord[];
    billableEntries: EditableTaskBillableEntryRecord[];
}

export interface EditableTaskAttachmentRecord {
    id: string;
    taskId: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
    createdAt: string;
    updatedAt: string;
}

export interface EditableTaskBillableEntryRecord {
    id: string;
    taskId: string;
    entryDate: string;
    hours: number;
    note: string;
    isValueAdd: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EditableTaskBillableRollupRecord {
    scopeType: string;
    scopeId: string;
    assignee: string;
    hours: number;
    sourceTaskId?: string | null;
}

export interface TaskSidebarFolderRecord {
    id: string;
    name: string;
    orderIndex: number;
}

export interface TaskSidebarBoardRecord {
    id: string;
    name: string;
    parentFolderId: string;
    orderIndex: number;
    clientId?: string | null;
    clientName?: string | null;
}

export interface TaskSidebarBoardPlacementRecord {
    boardId: string;
    source: "clickup" | "local";
    boardName?: string | null;
    clientId?: string | null;
    clientName?: string | null;
    parentFolderId: string;
    orderIndex: number;
}

export interface TaskSidebarFolderOverrideRecord {
    folderId: string;
    source: "clickup" | "local";
    name: string;
}

export interface TaskSidebarStructureRecord {
    folders: TaskSidebarFolderRecord[];
    boards: TaskSidebarBoardRecord[];
    placements: TaskSidebarBoardPlacementRecord[];
    folderOverrides: TaskSidebarFolderOverrideRecord[];
    hiddenFolderIds: string[];
    hiddenBoardIds: string[];
}

const DEFAULT_CAPACITY_GRID_RESOURCES: CapacityGridResource[] = [
    { id: "omair-javaid", name: "Omair Javaid", orderIndex: 0, consultantId: null },
    { id: "james-w", name: "James W.", orderIndex: 1, consultantId: null },
    { id: "monica", name: "Monica", orderIndex: 2, consultantId: null },
    { id: "greg", name: "Greg", orderIndex: 3, consultantId: null },
    { id: "nikko", name: "Nikko", orderIndex: 4, consultantId: null },
];

function slugify(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function normalizeName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeFirstToken(value: string) {
    const first = String(value || "").trim().split(/\s+/)[0] || "";
    return normalizeName(first);
}

function formatConsultantName(firstName: string, lastName: string) {
    return `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
}

function normalizeEmail(value: string) {
    return String(value || "").trim().toLowerCase();
}

function mapAppUser(row: any): AppUserRecord {
    const role = normalizeAppRole(String(row.role ?? "member"));
    return {
        id: String(row.id),
        firstName: String(row.firstName ?? "").trim(),
        lastName: String(row.lastName ?? "").trim(),
        email: normalizeEmail(String(row.email ?? "")),
        role,
        privileges: ROLE_DEFINITIONS[role].privileges,
        status: String(row.status ?? "invited"),
        invitedAt: row.invitedAt ? new Date(row.invitedAt).toISOString() : null,
        inviteSentAt: row.inviteSentAt ? new Date(row.inviteSentAt).toISOString() : null,
        inviteAcceptedAt: row.inviteAcceptedAt ? new Date(row.inviteAcceptedAt).toISOString() : null,
        lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
    };
}

function mapClientDirectory(row: any): ClientDirectoryRecord {
    return {
        id: String(row.id ?? "").trim(),
        name: String(row.name ?? row.clientName ?? row.id ?? "").trim(),
        team: row.team == null ? null : Number(row.team),
        sa: String(row.sa ?? "").trim(),
        dealType: String(row.dealType ?? "").trim(),
        min: row.min == null ? null : Number(row.min),
        max: row.max == null ? null : Number(row.max),
        isActive: Boolean(row.isActive ?? true),
        isInternal: Boolean(row.isInternal ?? false),
        sortOrder: Number(row.sortOrder ?? 0),
    };
}

function buildLegacyClientDefaults(rows: any[]): Map<string, LegacyClientDefaults> {
    const defaults = new Map<string, LegacyClientDefaults>();

    rows.forEach((row: any) => {
        const id = String(row.clientId ?? "").trim();
        if (!id) return;

        const current = defaults.get(id) ?? {
            name: String(row.clientName ?? row.clientId ?? "").trim() || id,
            team: row.team == null ? null : Number(row.team),
            sa: String(row.sa ?? "").trim(),
            dealType: String(row.dealType ?? "").trim(),
            min: row.min == null ? null : Number(row.min),
            max: row.max == null ? null : Number(row.max),
            sortOrder: Number(row.orderIndex ?? 0),
        };

        defaults.set(id, {
            name: current.name || String(row.clientName ?? row.clientId ?? "").trim() || id,
            team: current.team ?? (row.team == null ? null : Number(row.team)),
            sa: current.sa || String(row.sa ?? "").trim(),
            dealType: current.dealType || String(row.dealType ?? "").trim(),
            min: pickLegacyMetricValue(current.min, row.min == null ? null : Number(row.min)),
            max: pickLegacyMetricValue(current.max, row.max == null ? null : Number(row.max)),
            sortOrder: Number.isFinite(Number(current.sortOrder)) ? current.sortOrder : Number(row.orderIndex ?? 0),
        });
    });

    return defaults;
}

function buildLegacyCapacityGridDefaults(rows: any[]): Map<string, LegacyCapacityGridDefaults> {
    const defaults = new Map<string, LegacyCapacityGridDefaults>();

    rows.forEach((row: any) => {
        let parsedRows: any[] = [];
        try {
            parsedRows = Array.isArray(row?.rowsJson) ? row.rowsJson : JSON.parse(String(row?.rowsJson ?? "[]"));
        } catch {
            parsedRows = [];
        }

        parsedRows.forEach((clientRow: any) => {
            const id = String(clientRow?.id ?? "").trim();
            if (!id) return;

            const current = defaults.get(id) ?? {
                name: String(clientRow?.client ?? clientRow?.id ?? "").trim() || id,
                min: clientRow?.wkMin == null ? null : Number(clientRow.wkMin),
                max: clientRow?.wkMax == null ? null : Number(clientRow.wkMax),
            };

            defaults.set(id, {
                name: current.name || String(clientRow?.client ?? clientRow?.id ?? "").trim() || id,
                min: pickLegacyMetricValue(current.min, clientRow?.wkMin == null ? null : Number(clientRow.wkMin)),
                max: pickLegacyMetricValue(current.max, clientRow?.wkMax == null ? null : Number(clientRow.wkMax)),
            });
        });
    });

    return defaults;
}

function sortClientDirectoryRecords(records: ClientDirectoryRecord[]): ClientDirectoryRecord[] {
    return [...records].sort((a, b) => {
        if (a.isInternal !== b.isInternal) {
            return a.isInternal ? 1 : -1;
        }
        const orderDiff = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
}

async function ensureClientDirectorySeeded() {
    const clientDirectoryModel = (prisma as any).clientDirectory;
    if (!clientDirectoryModel) return;

    const legacyRows = await prisma.clientConfig.findMany({
        orderBy: [
            { orderIndex: "asc" },
            { week: "asc" },
            { clientName: "asc" },
        ],
    });

    if (legacyRows.length === 0) return;

    const legacyDefaults = buildLegacyClientDefaults(
        legacyRows
            .slice()
            .sort((a: any, b: any) => String(b.week ?? "").localeCompare(String(a.week ?? "")))
    );
    const gridDefaults = buildLegacyCapacityGridDefaults(
        await prisma.capacityGridConfig.findMany({
            orderBy: [
                { week: "desc" },
            ],
        })
    );

    gridDefaults.forEach((gridDefault, id) => {
        const current = legacyDefaults.get(id);
        if (!current) {
            legacyDefaults.set(id, {
                name: gridDefault.name,
                team: null,
                sa: "",
                dealType: "",
                min: gridDefault.min,
                max: gridDefault.max,
                sortOrder: 0,
            });
            return;
        }

        legacyDefaults.set(id, {
            ...current,
            name: current.name || gridDefault.name,
            min: pickLegacyMetricValue(current.min, gridDefault.min),
            max: pickLegacyMetricValue(current.max, gridDefault.max),
        });
    });

    const existingRows = await clientDirectoryModel.findMany();
    const existingById = new Map<string, any>(
        existingRows
            .map((row: any) => [String(row.id ?? "").trim(), row] as const)
            .filter((entry: readonly [string, any]) => Boolean(entry[0]))
    );

    const missing = new Map<string, ClientDirectoryRecord>();
    legacyDefaults.forEach((defaults, id) => {
        if (!id || existingById.has(id) || missing.has(id)) return;
        missing.set(id, {
            id,
            name: defaults.name,
            team: defaults.team,
            sa: defaults.sa,
            dealType: defaults.dealType,
            min: defaults.min,
            max: defaults.max,
            isActive: true,
            isInternal: false,
            sortOrder: defaults.sortOrder,
        });
    });

    for (const client of Array.from(missing.values())) {
        await clientDirectoryModel.create({
            data: {
                id: client.id,
                name: client.name,
                team: client.team,
                sa: client.sa,
                dealType: client.dealType,
                min: client.min,
                max: client.max,
                isActive: client.isActive,
                isInternal: client.isInternal,
                sortOrder: client.sortOrder,
            },
        });
    }

    for (const [id, existing] of Array.from(existingById.entries())) {
        const defaults = legacyDefaults.get(id);
        if (!defaults) continue;

        const patch: Record<string, unknown> = {};
        if ((existing.max == null || Number(existing.max) === 0) && defaults.max != null) {
            patch.max = defaults.max;
        }
        if ((existing.min == null || Number(existing.min) === 0) && defaults.min != null) {
            patch.min = defaults.min;
        }
        if ((!String(existing.name ?? "").trim()) && defaults.name) {
            patch.name = defaults.name;
        }
        if (existing.team == null && defaults.team != null) {
            patch.team = defaults.team;
        }
        if (!String(existing.sa ?? "").trim() && defaults.sa) {
            patch.sa = defaults.sa;
        }
        if (!String(existing.dealType ?? "").trim() && defaults.dealType) {
            patch.dealType = defaults.dealType;
        }

        if (Object.keys(patch).length > 0) {
            await clientDirectoryModel.update({
                where: { id },
                data: patch,
            });
        }
    }
}

async function loadClientDirectoryRecords(): Promise<ClientDirectoryRecord[]> {
    const clientDirectoryModel = (prisma as any).clientDirectory;
    if (!clientDirectoryModel) return [] as ClientDirectoryRecord[];
    await ensureClientDirectorySeeded();
    const rows = await clientDirectoryModel.findMany({
        orderBy: [
            { sortOrder: "asc" },
            { name: "asc" },
        ],
    });
    return sortClientDirectoryRecords(rows.map(mapClientDirectory));
}

function resourceIdFromName(name: string) {
    const id = slugify(name);
    return id.length > 0 ? id : `resource-${Date.now()}`;
}

function normalizeEditableTaskStatus(value: string): "backlog" | "open" | "closed" {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "closed") return "closed";
    if (normalized === "open") return "open";
    return "backlog";
}

function getTaskAttachmentStorageDir() {
    return path.join(process.cwd(), ".task-attachments");
}

async function ensureTaskAttachmentStorageDir() {
    await mkdir(getTaskAttachmentStorageDir(), { recursive: true });
}

function mapEditableTaskAttachment(row: any): EditableTaskAttachmentRecord {
    return {
        id: String(row.id),
        taskId: String(row.taskId),
        originalName: String(row.originalName ?? ""),
        storedName: String(row.storedName ?? ""),
        mimeType: String(row.mimeType ?? "application/octet-stream"),
        sizeBytes: Number(row.sizeBytes ?? 0),
        downloadUrl: `/api/task-attachments/${String(row.id)}`,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
    };
}

function mapEditableTaskBillableEntry(row: any): EditableTaskBillableEntryRecord {
    return {
        id: String(row.id),
        taskId: String(row.taskId),
        entryDate: String(row.entryDate ?? ""),
        hours: Number(row.hours ?? 0),
        note: String(row.note ?? ""),
        isValueAdd: Boolean(row.isValueAdd ?? false),
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
    };
}

function getWeekDateRange(week: string) {
    const start = new Date(`${week}T00:00:00`);
    const end = addDays(start, 6);
    return {
        start,
        end,
        startKey: week,
        endKey: end.toISOString().slice(0, 10),
    };
}

function getCurrentWeekStartKey() {
    return format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function buildResourcesFromConsultants(consultants?: CapacityGridConsultant[] | string[]): CapacityGridResource[] {
    if (!Array.isArray(consultants) || consultants.length === 0) return DEFAULT_CAPACITY_GRID_RESOURCES;

    const normalized = consultants
        .map((entry) => {
            if (typeof entry === "string") {
                const name = String(entry || "").trim();
                if (!name) return null;
                return { id: null, name };
            }
            const consultantId = Number(entry?.id ?? 0);
            const name = String(entry?.name ?? "").trim();
            if (!name) return null;
            return {
                id: Number.isFinite(consultantId) && consultantId > 0 ? consultantId : null,
                name,
            };
        })
        .filter(Boolean) as Array<{ id: number | null; name: string }>;

    if (normalized.length === 0) return DEFAULT_CAPACITY_GRID_RESOURCES;

    const unique = new Map<string, { id: number | null; name: string }>();
    normalized.forEach((entry) => {
        const key = entry.id ? `id:${entry.id}` : `name:${normalizeName(entry.name)}`;
        if (!key) return;
        const existing = unique.get(key);
        if (!existing || entry.name.length > existing.name.length) {
            unique.set(key, entry);
        }
    });

    return Array.from(unique.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry, idx) => ({
            id: entry.id ? `consultant-${entry.id}` : resourceIdFromName(entry.name),
            name: entry.name,
            orderIndex: idx,
            consultantId: entry.id,
        }));
}

function buildEmptyAllocations(resources: CapacityGridResource[]): Record<string, CapacityGridAllocation> {
    const allocations: Record<string, CapacityGridAllocation> = {};
    resources.forEach((resource) => {
        allocations[resource.id] = { hours: 0, source: "manual", note: "" };
    });
    return allocations;
}

function normalizeAllocationCell(cell: any): CapacityGridAllocation {
    const rawHours = cell?.hours ?? (Number(cell?.wt ?? 0) + Number(cell?.wPlus ?? 0));
    const hours = Number(rawHours ?? 0);
    const source = cell?.source === "clickup" || cell?.wtSource === "clickup" || cell?.wPlusSource === "clickup"
        ? "clickup"
        : "manual";
    return {
        hours,
        source,
        note: String(cell?.note ?? ""),
    };
}

function preferClientName(current: string, incoming: string) {
    const left = String(current || "").trim();
    const right = String(incoming || "").trim();
    if (!left) return right;
    if (!right) return left;
    return right.length >= left.length ? right : left;
}

async function applyClientDirectoryMetadataToCapacityPayload(payload: CapacityGridPayload): Promise<{ payload: CapacityGridPayload; changed: boolean }> {
    const clientDirectory = (await loadClientDirectoryRecords()).filter((client: ClientDirectoryRecord) => client.isActive);
    if (clientDirectory.length === 0) {
        return { payload, changed: false };
    }

    const rowById = new Map<string, CapacityGridRow>();
    const rowByName = new Map<string, CapacityGridRow>();
    payload.rows.forEach((row) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        if (idKey) rowById.set(idKey, row);
        if (nameKey) rowByName.set(nameKey, row);
    });

    let changed = payload.rows.length !== clientDirectory.length;
    const nextRows = clientDirectory.map((client) => {
        const match = rowById.get(normalizeName(client.id)) ?? rowByName.get(normalizeName(client.name));
        const baseRow = match ?? {
            id: client.id,
            team: client.team ?? 0,
            teamSa: client.sa,
            dealType: client.dealType,
            wkMin: client.min ?? 0,
            wkMax: client.max ?? 0,
            client: client.name,
            notes: "",
            allocations: buildEmptyAllocations(payload.resources),
        };

        const nextRow: CapacityGridRow = {
            ...baseRow,
            id: client.id,
            team: Number(client.team ?? baseRow.team ?? 0),
            teamSa: client.sa || String(baseRow.teamSa ?? ""),
            dealType: client.dealType || String(baseRow.dealType ?? ""),
            wkMin: Number(client.min ?? baseRow.wkMin ?? 0),
            wkMax: Number(client.max ?? baseRow.wkMax ?? 0),
            client: preferClientName(String(baseRow.client ?? ""), client.name),
            allocations: buildEmptyAllocations(payload.resources),
            notes: String(baseRow.notes ?? ""),
        };

        payload.resources.forEach((resource) => {
            nextRow.allocations[resource.id] = normalizeAllocationCell(baseRow.allocations?.[resource.id]);
        });

        if (!match) {
            changed = true;
        } else if (
            match.id !== nextRow.id
            || match.client !== nextRow.client
            || Number(match.team ?? 0) !== Number(nextRow.team ?? 0)
            || String(match.teamSa ?? "") !== String(nextRow.teamSa ?? "")
            || String(match.dealType ?? "") !== String(nextRow.dealType ?? "")
            || Number(match.wkMin ?? 0) !== Number(nextRow.wkMin ?? 0)
            || Number(match.wkMax ?? 0) !== Number(nextRow.wkMax ?? 0)
        ) {
            changed = true;
        }

        return nextRow;
    });

    return {
        payload: changed ? { ...payload, rows: nextRows } : payload,
        changed,
    };
}

function sanitizeCapacityPayload(input: any, forcedResources?: CapacityGridResource[]): CapacityGridPayload {
    const resources: CapacityGridResource[] = forcedResources && forcedResources.length > 0
        ? forcedResources
        : Array.isArray(input?.resources)
        ? input.resources.map((r: any, idx: number) => ({
            id: String(r?.id ?? `resource-${idx + 1}`),
            name: String(r?.name ?? `Resource ${idx + 1}`),
            orderIndex: Number(r?.orderIndex ?? idx),
            consultantId: Number.isFinite(Number(r?.consultantId))
                ? Number(r.consultantId)
                : null,
            removed: Boolean(r?.removed ?? false),
            removedAt: r?.removedAt ? String(r.removedAt) : null,
        }))
        : DEFAULT_CAPACITY_GRID_RESOURCES;

    const rows: CapacityGridRow[] = Array.isArray(input?.rows)
        ? input.rows.map((row: any, idx: number) => {
            const allocations = buildEmptyAllocations(resources);
            const incoming = row?.allocations ?? {};
            resources.forEach((resource) => {
                const cell = incoming[resource.id];
                if (cell) {
                    allocations[resource.id] = normalizeAllocationCell(cell);
                }
            });
            return {
                id: String(row?.id ?? `row-${idx + 1}`),
                team: Number(row?.team ?? 0),
                teamSa: String(row?.teamSa ?? ""),
                dealType: String(row?.dealType ?? ""),
                wkMin: Number(row?.wkMin ?? 0),
                wkMax: Number(row?.wkMax ?? 0),
                client: String(row?.client ?? `Client ${idx + 1}`),
                notes: String(row?.notes ?? ""),
                allocations,
            };
        })
        : [];

    return { resources, rows };
}

function remapCapacityPayloadToResources(payload: CapacityGridPayload, targetResources: CapacityGridResource[]): CapacityGridPayload {
    const existingById = new Map(payload.resources.map((r) => [r.id, r]));
    const existingByConsultantId = new Map(
        payload.resources
            .filter((r) => Number.isFinite(Number(r.consultantId)) && Number(r.consultantId) > 0)
            .map((r) => [Number(r.consultantId), r])
    );
    const existingByNorm = new Map(payload.resources.map((r) => [normalizeName(r.name), r]));
    const existingByFirstToken = new Map(payload.resources.map((r) => [normalizeFirstToken(r.name), r]));

    const rows = payload.rows.map((row) => {
        const nextAllocations = buildEmptyAllocations(targetResources);
        targetResources.forEach((target) => {
            const direct = row.allocations[target.id];
            if (direct) {
                nextAllocations[target.id] = normalizeAllocationCell(direct);
                return;
            }
            if (Number(target.consultantId) > 0) {
                const matchByConsultantId = existingByConsultantId.get(Number(target.consultantId));
                if (matchByConsultantId && row.allocations[matchByConsultantId.id]) {
                    const cell = row.allocations[matchByConsultantId.id];
                    nextAllocations[target.id] = normalizeAllocationCell(cell);
                    return;
                }
            }
            const matchByNorm = existingByNorm.get(normalizeName(target.name));
            if (matchByNorm && row.allocations[matchByNorm.id]) {
                const cell = row.allocations[matchByNorm.id];
                nextAllocations[target.id] = normalizeAllocationCell(cell);
                return;
            }
            const matchByFirstToken = existingByFirstToken.get(normalizeFirstToken(target.name));
            if (matchByFirstToken && row.allocations[matchByFirstToken.id]) {
                const cell = row.allocations[matchByFirstToken.id];
                nextAllocations[target.id] = normalizeAllocationCell(cell);
                return;
            }
            const matchById = existingById.get(target.id);
            if (matchById && row.allocations[matchById.id]) {
                const cell = row.allocations[matchById.id];
                nextAllocations[target.id] = normalizeAllocationCell(cell);
            }
        });

        return {
            ...row,
            allocations: nextAllocations,
        };
    });

    return {
        resources: targetResources,
        rows,
    };
}

function mergeCapacityPayloadWithRoster(payload: CapacityGridPayload, rosterResources: CapacityGridResource[]): CapacityGridPayload {
    const existingResources = Array.isArray(payload?.resources) ? payload.resources : [];
    const existingByConsultantId = new Map(
        existingResources
            .filter((r) => Number.isFinite(Number(r.consultantId)) && Number(r.consultantId) > 0)
            .map((r) => [Number(r.consultantId), r])
    );
    const existingByNorm = new Map(existingResources.map((r) => [normalizeName(r.name), r]));
    const existingByFirstToken = new Map(existingResources.map((r) => [normalizeFirstToken(r.name), r]));

    const additions = rosterResources.filter((resource) => {
        const consultantId = Number(resource.consultantId ?? 0);
        if (consultantId > 0 && existingByConsultantId.has(consultantId)) return false;
        const norm = normalizeName(resource.name);
        if (norm && existingByNorm.has(norm)) return false;
        const first = normalizeFirstToken(resource.name);
        if (first && existingByFirstToken.has(first)) return false;
        return true;
    });

    if (additions.length === 0) return payload;

    const resources = [
        ...existingResources,
        ...additions.map((resource, idx) => ({
            ...resource,
            orderIndex: existingResources.length + idx,
        })),
    ];

    const rows = payload.rows.map((row) => {
        const nextAllocations = { ...(row.allocations || {}) };
        additions.forEach((resource) => {
            if (!nextAllocations[resource.id]) {
                nextAllocations[resource.id] = { hours: 0, source: "manual", note: "" };
            }
        });
        return {
            ...row,
            allocations: nextAllocations,
        };
    });

    return {
        resources,
        rows,
    };
}

function alignCapacityPayloadToRoster(payload: CapacityGridPayload, rosterResources: CapacityGridResource[]): CapacityGridPayload {
    if (rosterResources.length === 0) return payload;

    const existingResources = Array.isArray(payload?.resources) ? payload.resources : [];
    const rosterByConsultantId = new Map(
        rosterResources
            .filter((resource) => Number(resource.consultantId ?? 0) > 0)
            .map((resource) => [Number(resource.consultantId), resource])
    );
    const rosterByNorm = new Map(rosterResources.map((resource) => [normalizeName(resource.name), resource]));
    const rosterByFirstToken = new Map(rosterResources.map((resource) => [normalizeFirstToken(resource.name), resource]));
    const existingByConsultantId = new Map(
        existingResources
            .filter((resource) => Number(resource?.consultantId ?? 0) > 0)
            .map((resource) => [Number(resource.consultantId), resource] as const)
    );
    const existingByNorm = new Map(existingResources.map((resource) => [normalizeName(String(resource?.name ?? "")), resource] as const));
    const existingByFirstToken = new Map(existingResources.map((resource) => [normalizeFirstToken(String(resource?.name ?? "")), resource] as const));

    const preservedResources = existingResources.filter((resource) => {
        if (Boolean(resource?.removed)) return true;
        if (Number(resource?.consultantId ?? 0) <= 0) return true;
        const consultantId = Number(resource?.consultantId ?? 0);
        if (consultantId > 0 && rosterByConsultantId.has(consultantId)) return false;
        const norm = normalizeName(String(resource?.name ?? ""));
        if (norm && rosterByNorm.has(norm)) return false;
        const firstToken = normalizeFirstToken(String(resource?.name ?? ""));
        if (firstToken && rosterByFirstToken.has(firstToken)) return false;
        return false;
    });

    const targetResources = [
        ...rosterResources.map((resource, idx) => {
            const consultantId = Number(resource.consultantId ?? 0);
            const existing =
                (consultantId > 0 ? existingByConsultantId.get(consultantId) : null)
                ?? existingByNorm.get(normalizeName(resource.name))
                ?? existingByFirstToken.get(normalizeFirstToken(resource.name))
                ?? null;

            return {
                ...resource,
                removed: Boolean(existing?.removed ?? resource.removed ?? false),
                removedAt: existing?.removedAt ? String(existing.removedAt) : (resource.removedAt ? String(resource.removedAt) : null),
                orderIndex: idx,
            };
        }),
        ...preservedResources
            .filter((resource) => !rosterResources.some((roster) => roster.id === resource.id))
            .map((resource, idx) => ({
                ...resource,
                orderIndex: rosterResources.length + idx,
            })),
    ];

    return remapCapacityPayloadToResources(payload, targetResources);
}

async function applyInitialWkMaxFromTarget(week: string, payload: CapacityGridPayload): Promise<{ payload: CapacityGridPayload; changed: boolean }> {
    const clientConfigs = await prisma.clientConfig.findMany({
        where: { week },
    });

    const targetById = new Map<string, number>();
    const targetByName = new Map<string, number>();
    clientConfigs.forEach((cfg) => {
        const target = Number(cfg.target ?? 0);
        if (target <= 0) return;
        const idKey = normalizeName(String(cfg.clientId ?? ""));
        const nameKey = normalizeName(String(cfg.clientName ?? ""));
        if (idKey) targetById.set(idKey, target);
        if (nameKey) targetByName.set(nameKey, target);
    });

    let changed = false;
    const nextRows = payload.rows.map((row) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        const hasMatch = targetById.has(idKey) || targetByName.has(nameKey);
        if (!hasMatch) return row;

        const target = Number(targetById.get(idKey) ?? targetByName.get(nameKey) ?? 0);
        const currentMax = Number(row.wkMax ?? 0);
        if (Math.abs(currentMax - target) < 0.01) return row;

        changed = true;
        return {
            ...row,
            wkMax: target,
        };
    });

    return {
        payload: changed ? { ...payload, rows: nextRows } : payload,
        changed,
    };
}

async function applyInitialTeamFromClientConfig(week: string, payload: CapacityGridPayload): Promise<{ payload: CapacityGridPayload; changed: boolean }> {
    const anyTeamSet = payload.rows.some((row) => Number(row.team ?? 0) > 0);
    if (anyTeamSet) return { payload, changed: false };

    const clientConfigs = await prisma.clientConfig.findMany({
        where: { week },
    });

    const teamById = new Map<string, number>();
    const teamByName = new Map<string, number>();
    clientConfigs.forEach((cfg) => {
        const team = Number(cfg.team ?? 0);
        if (!Number.isFinite(team) || team <= 0) return;
        const idKey = normalizeName(String(cfg.clientId ?? ""));
        const nameKey = normalizeName(String(cfg.clientName ?? ""));
        if (idKey) teamById.set(idKey, team);
        if (nameKey) teamByName.set(nameKey, team);
    });

    let changed = false;
    const nextRows = payload.rows.map((row) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        const team = Number(teamById.get(idKey) ?? teamByName.get(nameKey) ?? 0);
        if (!team || team <= 0) return row;
        changed = true;
        return {
            ...row,
            team,
        };
    });

    return {
        payload: changed ? { ...payload, rows: nextRows } : payload,
        changed,
    };
}

async function buildSeedCapacityGrid(week: string, consultants?: CapacityGridConsultant[] | string[]): Promise<CapacityGridPayload> {
    const resources = buildResourcesFromConsultants(consultants);
    const clientDirectory = (await loadClientDirectoryRecords()).filter((client) => client.isActive);
    if (clientDirectory.length > 0) {
        return {
            resources,
            rows: clientDirectory.map((client) => ({
                id: client.id,
                team: Number(client.team ?? 0),
                teamSa: client.sa,
                dealType: client.dealType,
                wkMin: Number(client.min ?? 0),
                wkMax: Number(client.max ?? 0),
                client: client.name,
                notes: "",
                allocations: buildEmptyAllocations(resources),
            })),
        };
    }

    let sourceConfigs = await prisma.clientConfig.findMany({
        where: { week },
        orderBy: { orderIndex: "asc" },
    });
    if (sourceConfigs.length === 0) {
        sourceConfigs = await prisma.clientConfig.findMany({
            where: { week: "2026-03-02" },
            orderBy: { orderIndex: "asc" },
        });
    }

    const rows: CapacityGridRow[] = sourceConfigs.map((cc, idx) => ({
        id: cc.clientId || `seed-${idx + 1}`,
        team: Number(cc.team ?? 0),
        teamSa: String(cc.sa ?? ""),
        dealType: String(cc.dealType ?? ""),
        wkMin: Number(cc.min ?? 0),
        wkMax: Number(cc.max ?? 0),
        client: String(cc.clientName ?? cc.clientId ?? `Client ${idx + 1}`),
        notes: "",
        allocations: buildEmptyAllocations(resources),
    }));

    if (rows.length > 0) return { resources, rows };

    const fallbackClients = [
        "Mikisew",
        "Sparetek",
        "ARKTikka",
        "Santec | Canada",
        "FPM",
        "Global Light",
        "SodaStream",
        "TIN (That's It Fruit)",
        "LSCU",
        "Global Gourmet",
        "Dye & Durham",
        "A2A",
        "Brainspire Office Furniture",
        "HPSA",
        "SIGA",
        "Pellucere",
        "BizRoR",
        "Centium/Tonix",
        "Centium/A3B",
        "Centium/C3CW",
        "Happy Feet",
    ];
    return {
        resources,
        rows: fallbackClients.map((name, idx) => ({
            id: slugify(name) || `client-${idx + 1}`,
            team: 0,
            teamSa: "",
            dealType: "",
            wkMin: 0,
            wkMax: 0,
            client: name,
            notes: "",
            allocations: buildEmptyAllocations(resources),
        })),
    };
}

export async function getWeekConfig(week: string) {
    return await prisma.weekConfig.findUnique({
        where: { week }
    });
}

export async function getWeekConfigsForYear(year: number) {
    const prefix = `${year}-`;
    return await prisma.weekConfig.findMany({
        where: {
            week: {
                startsWith: prefix
            }
        }
    });
}

export async function updateWeekConfig(week: string, baseTarget: number, stretchTarget: number) {
    await prisma.weekConfig.upsert({
        where: { week },
        update: { baseTarget, stretchTarget },
        create: { week, baseTarget, stretchTarget }
    });
    revalidatePath("/");
}

export async function getLeadConfigs(week: string) {
    return await prisma.leadConfig.findMany({
        where: { week }
    });
}

export async function updateLeadConfig(week: string, leadName: string, target: number) {
    await prisma.leadConfig.upsert({
        where: { week_leadName: { week, leadName } },
        update: { target },
        create: { week, leadName, target }
    });
    revalidatePath("/");
}

export async function getClientConfigs(week: string) {
    return await prisma.clientConfig.findMany({
        where: { week }
    });
}

export async function getClientDirectory(): Promise<ClientDirectoryRecord[]> {
    return loadClientDirectoryRecords();
}

export async function saveClientDirectoryEntry(input: {
    id?: string;
    name: string;
    team?: number | null;
    sa?: string;
    dealType?: string;
    min?: number | null;
    max?: number | null;
    isActive?: boolean;
    isInternal?: boolean;
    sortOrder?: number | null;
}) {
    const clientDirectoryModel = (prisma as any).clientDirectory;
    if (!clientDirectoryModel) return null;

    const name = String(input.name || "").trim();
    if (!name) {
        throw new Error("Client name is required.");
    }

    let id = String(input.id || "").trim();
    if (!id) {
        const baseId = slugify(name) || `client-${Date.now()}`;
        id = baseId;
        let suffix = 2;
        while (await clientDirectoryModel.findUnique({ where: { id } })) {
            id = `${baseId}-${suffix}`;
            suffix += 1;
        }
    }

    const saved = await clientDirectoryModel.upsert({
        where: { id },
        update: {
            name,
            team: input.team == null ? null : Number(input.team),
            sa: String(input.sa ?? "").trim(),
            dealType: String(input.dealType ?? "").trim(),
            min: input.min == null ? null : Number(input.min),
            max: input.max == null ? null : Number(input.max),
            isActive: input.isActive !== false,
            isInternal: Boolean(input.isInternal ?? false),
            sortOrder: input.sortOrder == null ? 0 : Number(input.sortOrder),
        },
        create: {
            id,
            name,
            team: input.team == null ? null : Number(input.team),
            sa: String(input.sa ?? "").trim(),
            dealType: String(input.dealType ?? "").trim(),
            min: input.min == null ? null : Number(input.min),
            max: input.max == null ? null : Number(input.max),
            isActive: input.isActive !== false,
            isInternal: Boolean(input.isInternal ?? false),
            sortOrder: input.sortOrder == null ? 0 : Number(input.sortOrder),
        },
    });

    revalidatePath("/");
    revalidatePath("/settings");
    return mapClientDirectory(saved);
}

export async function deleteClientDirectoryEntry(clientId: string) {
    const clientDirectoryModel = (prisma as any).clientDirectory;
    if (!clientDirectoryModel) return { ok: false };

    const normalizedId = String(clientId || "").trim();
    if (!normalizedId) return { ok: false };

    await clientDirectoryModel.delete({
        where: { id: normalizedId },
    });

    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true };
}

export async function updateClientConfig(week: string, clientId: string, data: { clientName?: string, orderIndex?: number, team?: number, sa?: string, dealType?: string, min?: number, max?: number, target?: number, mtHrs?: number, wPlusHrs?: number }) {
    await prisma.clientConfig.upsert({
        where: { week_clientId: { week, clientId } },
        update: data,
        create: {
            week,
            clientId,
            clientName: data.clientName ?? "",
            orderIndex: data.orderIndex ?? 0,
            team: data.team ?? 0,
            sa: data.sa ?? "",
            dealType: data.dealType ?? "",
            min: data.min ?? 0,
            target: data.target ?? 0,
            max: data.max ?? 0,
            mtHrs: data.mtHrs ?? 0,
            wPlusHrs: data.wPlusHrs ?? 0,
        }
    });
    revalidatePath("/");
}

export async function getConsultantConfigs(week: string) {
    return await prisma.consultantConfig.findMany({
        where: { week }
    });
}

export async function getConsultants(): Promise<ConsultantRecord[]> {
    const rows = await prisma.consultant.findMany({
        orderBy: [
            { firstName: "asc" },
            { lastName: "asc" },
            { email: "asc" },
        ],
    });

    return rows.map((row) => ({
        id: Number(row.id),
        firstName: String(row.firstName ?? "").trim(),
        lastName: String(row.lastName ?? "").trim(),
        email: String(row.email ?? "").trim(),
        fullName: formatConsultantName(String(row.firstName ?? ""), String(row.lastName ?? "")),
        source: String(row.source ?? "manual"),
        externalId: row.externalId ? String(row.externalId) : null,
    }));
}

async function syncClickUpConsultantsIntoLocalDirectory() {
    const now = Date.now();
    if (now - lastClickUpConsultantSyncAt < 5 * 60 * 1000) {
        return;
    }

    const [tasks, members] = await Promise.all([
        getTeamTasks(),
        getTeamMembers(),
    ]);

    const memberById = new Map<number, Awaited<ReturnType<typeof getTeamMembers>>[number]>();
    members.forEach((member) => {
        memberById.set(Number(member.id), member);
    });

    const rosterById = new Map<number, { id: number; firstName: string; lastName: string; email: string }>();
    tasks.forEach((task: any) => {
        if (!Array.isArray(task?.assignees)) return;
        task.assignees.forEach((assignee: any) => {
            const consultantId = Number(assignee?.id ?? 0);
            if (!Number.isFinite(consultantId) || consultantId <= 0) return;

            const member = memberById.get(consultantId);
            const fallbackName = formatConsultantName(
                String(assignee?.username ?? "").trim().split(/\s+/)[0] ?? "",
                String(assignee?.username ?? "").trim().split(/\s+/).slice(1).join(" ")
            ).trim();
            const fullName = String(member?.username ?? assignee?.username ?? fallbackName).trim();
            const nameParts = fullName.split(/\s+/).filter(Boolean);
            const firstName = String(member?.firstName ?? nameParts[0] ?? "").trim();
            const lastName = String(member?.lastName ?? nameParts.slice(1).join(" ")).trim();
            const email = normalizeEmail(String(member?.email ?? ""));
            if (!firstName || !email) return;

            rosterById.set(consultantId, {
                id: consultantId,
                firstName,
                lastName,
                email,
            });
        });
    });

    if (rosterById.size === 0) {
        lastClickUpConsultantSyncAt = now;
        return;
    }

    const existingConsultants = await prisma.consultant.findMany();

    const consultantById = new Map<number, any>();
    const consultantByEmail = new Map<string, any>();
    existingConsultants.forEach((consultant) => {
        consultantById.set(Number(consultant.id), consultant);
        consultantByEmail.set(normalizeEmail(String(consultant.email ?? "")), consultant);
    });

    for (const consultant of Array.from(rosterById.values())) {
        const existingById = consultantById.get(consultant.id);
        const existingByEmail = consultantByEmail.get(consultant.email);

        if (existingById) {
            await prisma.consultant.update({
                where: { id: consultant.id },
                data: {
                    firstName: consultant.firstName,
                    lastName: consultant.lastName,
                    email: consultant.email,
                    source: "clickup",
                    externalId: String(consultant.id),
                },
            });
        } else if (existingByEmail) {
            await prisma.consultant.update({
                where: { email: consultant.email },
                data: {
                    firstName: consultant.firstName,
                    lastName: consultant.lastName,
                    source: "clickup",
                    externalId: String(consultant.id),
                },
            });
        } else {
            await prisma.consultant.create({
                data: {
                    id: consultant.id,
                    firstName: consultant.firstName,
                    lastName: consultant.lastName,
                    email: consultant.email,
                    source: "clickup",
                    externalId: String(consultant.id),
                },
            });
        }

    }

    lastClickUpConsultantSyncAt = now;
}

async function ensureClickUpConsultantsSynced() {
    if (!clickUpConsultantSyncPromise) {
        clickUpConsultantSyncPromise = syncClickUpConsultantsIntoLocalDirectory()
            .catch((error) => {
                console.error("Unable to sync ClickUp consultants", error);
            })
            .finally(() => {
                clickUpConsultantSyncPromise = null;
            });
    }

    await clickUpConsultantSyncPromise;
}

export async function syncClickUpConsultantsAndUsers(): Promise<ConsultantRecord[]> {
    await ensureClickUpConsultantsSynced();
    return await getConsultantUtilizationDirectory();
}

export async function getConsultantUtilizationDirectory(week?: string): Promise<ConsultantRecord[]> {
    const savedConsultants = await getConsultants();
    const provisionedEmails = new Set(
        (await prisma.appUser.findMany({
            where: {
                status: {
                    not: "disabled",
                },
            },
            select: { email: true },
        }))
            .map((row) => normalizeEmail(String(row?.email ?? "")))
            .filter((email) => email.length > 0)
    );

    return savedConsultants.filter((consultant) => {
        const email = normalizeEmail(consultant.email);
        return email.length > 0 && provisionedEmails.has(email);
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function ensureConsultantsProvisionedAsAppUsers(consultantsInput?: ConsultantRecord[]) {
    const consultants = consultantsInput ?? await getConsultants();

    for (const consultant of consultants) {
        const email = normalizeEmail(consultant.email);
        if (!email) continue;

        await prisma.appUser.upsert({
            where: { email },
            update: {
                firstName: consultant.firstName,
                lastName: consultant.lastName,
            },
            create: {
                firstName: consultant.firstName,
                lastName: consultant.lastName,
                email,
                role: "member",
                status: "invited",
            },
        });
    }

    revalidatePath("/settings");
}

async function ensureConsultantExistsForUser(input: {
    firstName: string;
    lastName: string;
    email: string;
}) {
    const firstName = String(input.firstName || "").trim();
    const lastName = String(input.lastName || "").trim();
    const email = normalizeEmail(input.email);
    if (!firstName || !lastName || !email) return;

    const existing = await prisma.consultant.findUnique({
        where: { email },
    });

    if (existing) {
        await prisma.consultant.update({
            where: { email },
            data: {
                firstName,
                lastName,
            },
        });
        return;
    }

    const consultantId = await allocateManualConsultantId();

    await prisma.consultant.create({
        data: {
            id: consultantId,
            firstName,
            lastName,
            email,
            source: "manual",
        },
    });
}

export async function getConsultantConfigsForYear(year: number) {
    const prefix = `${year}-`;
    return await prisma.consultantConfig.findMany({
        where: {
            week: {
                startsWith: prefix
            }
        }
    });
}

export async function updateConsultantConfig(week: string, consultantId: number, data: { maxCapacity?: number, billableCapacity?: number, mtHrs?: number, wPlusHrs?: number, notes?: string }) {
    await prisma.consultantConfig.upsert({
        where: { week_consultantId: { week, consultantId } },
        update: data,
        create: {
            week,
            consultantId,
            maxCapacity: data.maxCapacity ?? 40,
            billableCapacity: data.billableCapacity ?? 40,
            mtHrs: data.mtHrs ?? 0,
            wPlusHrs: data.wPlusHrs ?? 0,
            notes: data.notes ?? ""
        }
    });
    revalidatePath("/");
}

async function allocateManualConsultantId(): Promise<number> {
    const lowestConsultant = await prisma.consultant.findFirst({
        orderBy: { id: "asc" },
        select: { id: true },
    });
    const candidate = typeof lowestConsultant?.id === "number" && lowestConsultant.id < 0
        ? lowestConsultant.id - 1
        : -1;

    if (candidate < -2147483648) {
        throw new Error("No more available manual consultant IDs.");
    }

    return candidate;
}

export async function createConsultant(input: {
    firstName: string;
    lastName: string;
    email: string;
}): Promise<ConsultantRecord> {
    const firstName = String(input.firstName || "").trim();
    const lastName = String(input.lastName || "").trim();
    const email = String(input.email || "").trim().toLowerCase();

    if (!firstName) {
        throw new Error("First name is required.");
    }
    if (!lastName) {
        throw new Error("Second name is required.");
    }
    if (!email) {
        throw new Error("Email address is required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Enter a valid email address.");
    }

    const consultantId = await allocateManualConsultantId();

    try {
        const created = await prisma.consultant.create({
            data: {
                id: consultantId,
                firstName,
                lastName,
                email,
                source: "manual",
            },
        });

        await prisma.appUser.upsert({
            where: { email },
            update: {
                firstName,
                lastName,
            },
            create: {
                firstName,
                lastName,
                email,
                role: "member",
                status: "invited",
            },
        });

        revalidatePath("/");
        revalidatePath("/settings");

        return {
            id: Number(created.id),
            firstName: String(created.firstName ?? "").trim(),
            lastName: String(created.lastName ?? "").trim(),
            email: String(created.email ?? "").trim(),
            fullName: formatConsultantName(String(created.firstName ?? ""), String(created.lastName ?? "")),
            source: String(created.source ?? "manual"),
            externalId: created.externalId ? String(created.externalId) : null,
        };
    } catch (error: any) {
        if (String(error?.code || "") === "P2002") {
            throw new Error("A consultant with that email address already exists.");
        }
        throw error;
    }
}

async function issueAppUserInvite(row: any, inviterName: string) {
    const inviteToken = randomBytes(24).toString("hex");
    const inviteExpiresAt = addDays(new Date(), 7);
    const currentStatus = String(row?.status ?? "invited");

    const preparedUser = await prisma.appUser.update({
        where: { id: String(row.id) },
        data: {
            inviteToken,
            inviteExpiresAt,
            invitedAt: row.invitedAt ?? new Date(),
        },
    });

    const inviteUrl = getInviteUrl(inviteToken, String(preparedUser.email));
    const emailResult = await sendInviteEmail({
        email: String(preparedUser.email),
        firstName: String(preparedUser.firstName ?? ""),
        inviterName,
        inviteUrl,
        roleLabel: ROLE_DEFINITIONS[normalizeAppRole(String(preparedUser.role ?? "member"))].label,
    });

    const finalizedUser = emailResult.ok
        ? await prisma.appUser.update({
            where: { id: String(preparedUser.id) },
            data: {
                inviteSentAt: new Date(),
                status: currentStatus === "active" ? "active" : "sent",
            },
        })
        : preparedUser;

    return {
        user: mapAppUser(finalizedUser),
        emailSent: emailResult.ok,
        emailError: emailResult.ok ? null : emailResult.reason,
    };
}

export async function getAppUsers(consultantsInput?: ConsultantRecord[]): Promise<AppUserRecord[]> {
    const rows = await prisma.appUser.findMany({
        orderBy: [
            { createdAt: "asc" },
            { email: "asc" },
        ],
    });

    return rows.map(mapAppUser);
}

async function setAppUserDisabledByEmail(email: string) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;

    const existing = await prisma.appUser.findUnique({
        where: { email: normalizedEmail },
    });
    if (!existing) return null;

    return await prisma.appUser.update({
        where: { email: normalizedEmail },
        data: {
            status: "disabled",
            inviteToken: null,
            inviteExpiresAt: null,
        },
    });
}

async function updateConsultantRosterRemovalState(input: {
    week: string;
    consultantId?: number | null;
    consultantName?: string | null;
    resourceId?: string | null;
    removed: boolean;
    removedAt?: string | null;
}): Promise<CapacityGridPayload | null> {
    const week = String(input.week || "").trim() || getCurrentWeekStartKey();
    const consultantId = Number(input.consultantId ?? 0);
    const consultantName = String(input.consultantName || "").trim();
    const resourceId = String(input.resourceId || "").trim();
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) return null;

    let existing = await capacityGridModel.findUnique({
        where: { week },
    });

    if (!existing) {
        const consultantRoster = await getConsultantUtilizationDirectory(week);
        const seed = await buildSeedCapacityGrid(
            week,
            consultantRoster.map((consultant) => ({ id: consultant.id, name: consultant.fullName }))
        );
        await capacityGridModel.create({
            data: {
                week,
                resourcesJson: JSON.stringify(seed.resources),
                rowsJson: JSON.stringify(seed.rows),
            },
        });
        existing = await capacityGridModel.findUnique({
            where: { week },
        });
    }

    if (!existing) return null;

    const parsed = sanitizeCapacityPayload({
        resources: JSON.parse(existing.resourcesJson || "[]"),
        rows: JSON.parse(existing.rowsJson || "[]"),
    });

    let changed = false;
    const consultantNameKey = normalizeName(consultantName);
    const nextRemovedAt = input.removed ? (String(input.removedAt || "").trim() || new Date().toISOString()) : null;

    const nextResources = parsed.resources.map((resource, idx) => {
        const resourceConsultantId = Number(resource?.consultantId ?? 0);
        const resourceNameKey = normalizeName(String(resource?.name ?? ""));
        const matches = (
            (resourceId && String(resource?.id ?? "") === resourceId)
            || (consultantId > 0 && resourceConsultantId === consultantId)
            || (consultantNameKey && resourceNameKey === consultantNameKey)
        );

        if (!matches) {
            return {
                ...resource,
                orderIndex: idx,
            };
        }

        const currentRemoved = Boolean(resource?.removed ?? false);
        const currentRemovedAt = resource?.removedAt ? String(resource.removedAt) : null;
        if (currentRemoved !== input.removed || currentRemovedAt !== nextRemovedAt) {
            changed = true;
        }

        return {
            ...resource,
            removed: input.removed,
            removedAt: nextRemovedAt,
            orderIndex: idx,
        };
    });

    const nextPayload: CapacityGridPayload = {
        resources: nextResources,
        rows: parsed.rows,
    };

    if (changed) {
        await capacityGridModel.update({
            where: { week },
            data: {
                resourcesJson: JSON.stringify(nextPayload.resources),
                rowsJson: JSON.stringify(nextPayload.rows),
            },
        });
    }

    return nextPayload;
}

export async function deactivateProvisionedUser(userId: string, week?: string) {
    const user = await prisma.appUser.findUnique({
        where: { id: String(userId) },
    });
    if (!user) {
        throw new Error("User not found.");
    }

    const targetWeek = String(week || "").trim() || getCurrentWeekStartKey();
    const consultant = await prisma.consultant.findUnique({
        where: { email: normalizeEmail(String(user.email ?? "")) },
    });

    const updatedUser = await prisma.appUser.update({
        where: { id: String(userId) },
        data: {
            status: "disabled",
            inviteToken: null,
            inviteExpiresAt: null,
        },
    });

    const capacityGrid = consultant
        ? await updateConsultantRosterRemovalState({
            week: targetWeek,
            consultantId: Number(consultant.id),
            consultantName: formatConsultantName(String(consultant.firstName ?? ""), String(consultant.lastName ?? "")),
            removed: true,
            removedAt: new Date().toISOString(),
        })
        : null;

    revalidatePath("/settings");

    return {
        user: mapAppUser(updatedUser),
        capacityGrid,
    };
}

export async function deactivateConsultantFromUtilization(input: {
    week: string;
    consultantId: number;
    consultantName?: string;
    consultantEmail?: string;
    resourceId?: string;
}) {
    const week = String(input.week || "").trim() || getCurrentWeekStartKey();
    const consultantId = Number(input.consultantId ?? 0);
    if (!consultantId) {
        throw new Error("Consultant not found.");
    }

    const consultant = await prisma.consultant.findUnique({
        where: { id: consultantId },
    });

    const consultantEmail = normalizeEmail(String(input.consultantEmail || consultant?.email || ""));
    const updatedUser = consultantEmail ? await setAppUserDisabledByEmail(consultantEmail) : null;
    const capacityGrid = await updateConsultantRosterRemovalState({
        week,
        consultantId,
        consultantName: String(input.consultantName || formatConsultantName(String(consultant?.firstName ?? ""), String(consultant?.lastName ?? ""))).trim(),
        resourceId: String(input.resourceId || "").trim(),
        removed: true,
        removedAt: new Date().toISOString(),
    });

    revalidatePath("/settings");

    return {
        user: updatedUser ? mapAppUser(updatedUser) : null,
        capacityGrid,
    };
}

export async function inviteAppUser(input: {
    firstName: string;
    lastName: string;
    email: string;
    role: AppRole;
    inviterName?: string;
}) {
    const firstName = String(input.firstName || "").trim();
    const lastName = String(input.lastName || "").trim();
    const email = normalizeEmail(input.email);
    const role = normalizeAppRole(String(input.role || "member"));
    const inviterName = String(input.inviterName || "Mission Control").trim();

    if (!firstName) {
        throw new Error("First name is required.");
    }
    if (!lastName) {
        throw new Error("Last name is required.");
    }
    if (!email) {
        throw new Error("Email address is required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Enter a valid email address.");
    }

    const existing = await prisma.appUser.findUnique({
        where: { email },
    });

    const user = existing
        ? await prisma.appUser.update({
            where: { email },
            data: {
                firstName,
                lastName,
                role,
                status: existing.status === "disabled" ? "invited" : existing.status,
            },
        })
        : await prisma.appUser.create({
            data: {
                firstName,
                lastName,
                email,
                role,
                status: "invited",
            },
        });

    await ensureConsultantExistsForUser({ firstName, lastName, email });

    const result = await issueAppUserInvite(user, inviterName);
    revalidatePath("/settings");
    return result;
}

export async function resendAppUserInvite(userId: string, inviterName?: string) {
    const user = await prisma.appUser.findUnique({
        where: { id: String(userId) },
    });
    if (!user) {
        throw new Error("User not found.");
    }
    const result = await issueAppUserInvite(user, String(inviterName || "Mission Control").trim());
    revalidatePath("/settings");
    return result;
}

export async function updateAppUserRole(userId: string, role: AppRole) {
    const updated = await prisma.appUser.update({
        where: { id: String(userId) },
        data: {
            role: normalizeAppRole(String(role || "member")),
        },
    });

    revalidatePath("/settings");
    return mapAppUser(updated);
}

export async function getAppUserInviteContext(input: { token?: string; email?: string }) {
    const token = String(input.token || "").trim();
    const email = normalizeEmail(input.email || "");
    if (!token && !email) return null;

    const user = await prisma.appUser.findFirst({
        where: token
            ? { inviteToken: token }
            : { email },
    });

    if (!user) return null;

    const isExpired = Boolean(user.inviteExpiresAt && user.inviteExpiresAt.getTime() < Date.now());
    return {
        email: String(user.email),
        firstName: String(user.firstName ?? ""),
        isExpired,
        isValid: Boolean(user.inviteToken) && !isExpired,
        status: String(user.status ?? "invited"),
    };
}

export async function getCapacityGridConfig(
    week: string,
    consultants?: CapacityGridConsultant[] | string[]
): Promise<CapacityGridPayload> {
    const rosterResources = buildResourcesFromConsultants(consultants);
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) {
        return buildSeedCapacityGrid(week, consultants);
    }

    const existing = await capacityGridModel.findUnique({
        where: { week },
    });

    if (!existing) {
        const seed = await buildSeedCapacityGrid(week, consultants);
        await capacityGridModel.create({
            data: {
                week,
                resourcesJson: JSON.stringify(seed.resources),
                rowsJson: JSON.stringify(seed.rows),
            },
        });
        return seed;
    }

    try {
        const parsed = sanitizeCapacityPayload({
            resources: JSON.parse(existing.resourcesJson || "[]"),
            rows: JSON.parse(existing.rowsJson || "[]"),
        });
        const aligned = consultants && consultants.length > 0
            ? alignCapacityPayloadToRoster(parsed, rosterResources)
            : parsed;
        const clientDirectoryApplied = await applyClientDirectoryMetadataToCapacityPayload(aligned);

        const hasResourceDiff =
            JSON.stringify(clientDirectoryApplied.payload.resources) !== JSON.stringify(parsed.resources) ||
            JSON.stringify(clientDirectoryApplied.payload.rows) !== JSON.stringify(parsed.rows);

        if (hasResourceDiff || clientDirectoryApplied.changed) {
            await capacityGridModel.update({
                where: { week },
                data: {
                    resourcesJson: JSON.stringify(clientDirectoryApplied.payload.resources),
                    rowsJson: JSON.stringify(clientDirectoryApplied.payload.rows),
                },
            });
        }

        return clientDirectoryApplied.payload;
    } catch {
        const seed = await buildSeedCapacityGrid(week, consultants);
        await capacityGridModel.update({
            where: { week },
            data: {
                resourcesJson: JSON.stringify(seed.resources),
                rowsJson: JSON.stringify(seed.rows),
            },
        });
        return seed;
    }
}

export async function getCapacityGridConfigsForYear(year: number): Promise<CapacityGridWeekRecord[]> {
    const prefix = `${year}-`;
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) return [];

    const rows = await capacityGridModel.findMany({
        where: {
            week: {
                startsWith: prefix
            }
        },
        orderBy: {
            week: "asc"
        }
    });

    return rows.map((row: any) => {
        try {
            return {
                week: String(row.week),
                payload: sanitizeCapacityPayload({
                    resources: JSON.parse(String(row.resourcesJson || "[]")),
                    rows: JSON.parse(String(row.rowsJson || "[]")),
                }),
            };
        } catch {
            return {
                week: String(row.week),
                payload: { resources: [], rows: [] },
            };
        }
    });
}

export async function updateCapacityGridConfig(week: string, payload: CapacityGridPayload) {
    const sanitized = sanitizeCapacityPayload(payload);
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) return;

    await capacityGridModel.upsert({
        where: { week },
        update: {
            resourcesJson: JSON.stringify(sanitized.resources),
            rowsJson: JSON.stringify(sanitized.rows),
        },
        create: {
            week,
            resourcesJson: JSON.stringify(sanitized.resources),
            rowsJson: JSON.stringify(sanitized.rows),
        },
    });
    revalidatePath("/");
}

function getPriorWeek(week: string) {
    return addWeeks(new Date(`${week}T00:00:00`), -1).toISOString().slice(0, 10);
}

export async function copyCapacityGridFromPriorWeek(week: string, consultants?: CapacityGridConsultant[] | string[]) {
    const previousWeek = getPriorWeek(week);
    const [previousGrid, currentGrid] = await Promise.all([
        getCapacityGridConfig(previousWeek, consultants),
        getCapacityGridConfig(week, consultants),
    ]);

    const targetResources = currentGrid.resources.length > 0 ? currentGrid.resources : previousGrid.resources;
    const remappedPrevious = remapCapacityPayloadToResources(previousGrid, targetResources);
    const alignedCurrent = await applyClientDirectoryMetadataToCapacityPayload(currentGrid);

    const previousRowsById = new Map<string, CapacityGridRow>();
    const previousRowsByName = new Map<string, CapacityGridRow>();
    remappedPrevious.rows.forEach((row) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        if (idKey) previousRowsById.set(idKey, row);
        if (nameKey) previousRowsByName.set(nameKey, row);
    });

    const nextRows = alignedCurrent.payload.rows.map((row) => {
        const previousRow = previousRowsById.get(normalizeName(row.id)) ?? previousRowsByName.get(normalizeName(row.client));
        if (!previousRow) {
            return {
                ...row,
                notes: String(row.notes ?? ""),
            };
        }

        const allocations = buildEmptyAllocations(alignedCurrent.payload.resources);
        alignedCurrent.payload.resources.forEach((resource) => {
            allocations[resource.id] = normalizeAllocationCell(previousRow.allocations?.[resource.id]);
        });

        return {
            ...row,
            allocations,
            notes: String(row.notes ?? ""),
        };
    });

    const nextPayload = {
        resources: alignedCurrent.payload.resources,
        rows: nextRows,
    };

    await updateCapacityGridConfig(week, nextPayload);
    return nextPayload;
}

export async function copyConsultantUtilizationFromPriorWeek(week: string, consultants?: CapacityGridConsultant[] | string[]) {
    const previousWeek = getPriorWeek(week);
    const [previousConfigs, currentGrid, previousGrid] = await Promise.all([
        prisma.consultantConfig.findMany({ where: { week: previousWeek } }),
        getCapacityGridConfig(week, consultants),
        getCapacityGridConfig(previousWeek, consultants),
    ]);

    const currentResources = Array.isArray(currentGrid?.resources) ? currentGrid.resources : [];
    const previousResources = Array.isArray(previousGrid?.resources) ? previousGrid.resources : [];

    const currentNameById = new Map<number, string>();
    const currentIdByName = new Map<string, number>();
    currentResources.forEach((resource) => {
        const consultantId = Number(resource?.consultantId ?? 0);
        const consultantName = String(resource?.name ?? "").trim();
        if (consultantId > 0) {
            currentNameById.set(consultantId, consultantName);
        }
        const nameKey = normalizeName(consultantName);
        if (consultantId > 0 && nameKey && !currentIdByName.has(nameKey)) {
            currentIdByName.set(nameKey, consultantId);
        }
    });

    const previousNameById = new Map<number, string>();
    previousResources.forEach((resource) => {
        const consultantId = Number(resource?.consultantId ?? 0);
        const consultantName = String(resource?.name ?? "").trim();
        if (consultantId > 0 && consultantName) {
            previousNameById.set(consultantId, consultantName);
        }
    });

    const consultantEntries = Array.isArray(consultants) ? consultants : [];
    consultantEntries.forEach((entry) => {
        if (typeof entry === "string") return;
        const consultantId = Number(entry?.id ?? 0);
        const consultantName = String(entry?.name ?? "").trim();
        if (consultantId > 0 && consultantName) {
            if (!currentNameById.has(consultantId)) currentNameById.set(consultantId, consultantName);
            const nameKey = normalizeName(consultantName);
            if (nameKey && !currentIdByName.has(nameKey)) {
                currentIdByName.set(nameKey, consultantId);
            }
        }
    });

    const copiedConsultantIds = new Set<number>();

    for (const row of previousConfigs) {
        const sourceConsultantId = Number(row.consultantId ?? 0);
        if (sourceConsultantId <= 0) continue;

        const directMatchId = currentNameById.has(sourceConsultantId) ? sourceConsultantId : null;
        const previousName = previousNameById.get(sourceConsultantId) ?? "";
        const fallbackMatchId = currentIdByName.get(normalizeName(previousName)) ?? null;
        const targetConsultantId = directMatchId ?? fallbackMatchId;
        if (!targetConsultantId || copiedConsultantIds.has(targetConsultantId)) continue;

        await prisma.consultantConfig.upsert({
            where: {
                week_consultantId: {
                    week,
                    consultantId: targetConsultantId,
                },
            },
            update: {
                maxCapacity: Number(row.maxCapacity ?? 40),
                billableCapacity: Number(row.billableCapacity ?? 40),
                mtHrs: 0,
                wPlusHrs: 0,
                notes: "",
            },
            create: {
                week,
                consultantId: targetConsultantId,
                maxCapacity: Number(row.maxCapacity ?? 40),
                billableCapacity: Number(row.billableCapacity ?? 40),
                mtHrs: 0,
                wPlusHrs: 0,
                notes: "",
            },
        });

        copiedConsultantIds.add(targetConsultantId);
    }

    const currentConsultantIds = currentResources
        .map((resource) => Number(resource?.consultantId ?? 0))
        .filter((consultantId) => consultantId > 0);

    const consultantConfigs = await prisma.consultantConfig.findMany({
        where: currentConsultantIds.length > 0
            ? {
                week,
                consultantId: {
                    in: currentConsultantIds,
                },
            }
            : { week },
    });

    revalidatePath("/");
    return {
        consultantConfigs: consultantConfigs.map((row) => ({
            consultantId: Number(row.consultantId),
            maxCapacity: Number(row.maxCapacity ?? 40),
            billableCapacity: Number(row.billableCapacity ?? 40),
            notes: String(row.notes ?? ""),
        })),
        capacityGrid: currentGrid,
    };
}

export async function loadDashboardWeekData(
    week: string,
    consultants?: CapacityGridConsultant[] | string[]
) {
    const previousWeek = getPriorWeek(week);
    const [
        weekConfig,
        leadConfigs,
        clientConfigs,
        clientDirectory,
        consultantConfigs,
        previousLeadConfigs,
        previousClientConfigs,
        previousConsultantConfigs,
        capacityGridConfig,
        taskBillableRollups,
        previousTaskBillableRollups,
    ] = await Promise.all([
        getWeekConfig(week),
        getLeadConfigs(week),
        getClientConfigs(week),
        getClientDirectory(),
        getConsultantConfigs(week),
        getLeadConfigs(previousWeek),
        getClientConfigs(previousWeek),
        getConsultantConfigs(previousWeek),
        getCapacityGridConfig(week, consultants),
        getEditableTaskBillableRollups(week),
        getEditableTaskBillableRollups(previousWeek),
    ]);

    return {
        weekConfig,
        leadConfigs,
        clientConfigs,
        clientDirectory,
        consultantConfigs,
        previousLeadConfigs,
        previousClientConfigs,
        previousConsultantConfigs,
        capacityGridConfig,
        taskBillableRollups,
        previousTaskBillableRollups,
    };
}

export async function getEditableTasks(
    week: string,
    scopeType: string,
    scopeId: string,
    seedTasks: EditableTaskSeed[] = []
): Promise<EditableTaskRecord[]> {
    const editableTaskModel = (prisma as any).editableTask;
    if (!editableTaskModel) return [];

    const normalizedScopeType = String(scopeType || "all");
    const normalizedScopeId = String(scopeId || "all");

    const existingRows = await editableTaskModel.findMany({
        where: {
            week,
            scopeType: normalizedScopeType,
            scopeId: normalizedScopeId,
        },
        include: {
            attachments: {
                orderBy: [{ createdAt: "desc" }],
            },
            billableEntries: {
                orderBy: [
                    { entryDate: "desc" },
                    { createdAt: "desc" },
                ],
            },
        },
        orderBy: [
            { status: "asc" },
            { position: "asc" },
            { createdAt: "asc" },
        ],
    });

    const filteredSeedTasks = seedTasks.filter((task) => String(task?.week ?? "") === week);
    const allowedSourceTaskIds = new Set(
        filteredSeedTasks
            .map((task) => String(task?.sourceTaskId ?? "").trim())
            .filter(Boolean)
    );
    const canonicalStatusBySourceTaskId = new Map<string, { status: "backlog" | "open" | "closed"; priority: number; updatedAtMs: number }>();

    if (allowedSourceTaskIds.size > 0) {
        const siblingRows = await editableTaskModel.findMany({
            where: {
                week,
                sourceTaskId: {
                    in: Array.from(allowedSourceTaskIds),
                },
            },
            select: {
                sourceTaskId: true,
                scopeType: true,
                scopeId: true,
                status: true,
                updatedAt: true,
            },
        });

        siblingRows.forEach((row: any) => {
            const sourceTaskId = String(row?.sourceTaskId ?? "").trim();
            if (!sourceTaskId) return;

            const priority = String(row?.scopeType ?? "") === "all" && String(row?.scopeId ?? "") === "all" ? 1 : 2;
            const updatedAtMs = new Date(row?.updatedAt ?? 0).getTime();
            const current = canonicalStatusBySourceTaskId.get(sourceTaskId);

            if (!current || priority > current.priority || (priority === current.priority && updatedAtMs >= current.updatedAtMs)) {
                canonicalStatusBySourceTaskId.set(sourceTaskId, {
                    status: normalizeEditableTaskStatus(String(row?.status ?? "backlog")),
                    priority,
                    updatedAtMs,
                });
            }
        });
    }

    const stalePlaceholderIds = allowedSourceTaskIds.size > 0
        ? existingRows
            .filter((row: any) => {
                const sourceTaskId = String(row?.sourceTaskId ?? "").trim();
                return sourceTaskId && !allowedSourceTaskIds.has(sourceTaskId);
            })
            .map((row: any) => String(row.id))
        : [];

    if (stalePlaceholderIds.length > 0) {
        await editableTaskModel.deleteMany({
            where: {
                id: {
                    in: stalePlaceholderIds,
                },
            },
        });
    }

    const refreshedExistingRows = stalePlaceholderIds.length > 0
        ? await editableTaskModel.findMany({
            where: {
                week,
                scopeType: normalizedScopeType,
                scopeId: normalizedScopeId,
            },
            include: {
                attachments: {
                    orderBy: [{ createdAt: "desc" }],
                },
                billableEntries: {
                    orderBy: [
                        { entryDate: "desc" },
                        { createdAt: "desc" },
                    ],
                },
            },
            orderBy: [
                { status: "asc" },
                { position: "asc" },
                { createdAt: "asc" },
            ],
        })
        : existingRows;

    const positionByStatus = new Map<string, number>();
    refreshedExistingRows.forEach((row: any) => {
        const status = normalizeEditableTaskStatus(String(row?.status ?? "backlog"));
        positionByStatus.set(status, Math.max(Number(positionByStatus.get(status) ?? 0), Number(row?.position ?? 0)));
    });

    const refreshedExistingBySourceTaskId = new Map(
        refreshedExistingRows
            .map((row: any) => [String(row?.sourceTaskId ?? "").trim(), row] as const)
            .filter((entry: readonly [string, any]) => Boolean(entry[0]))
    );

    for (const task of filteredSeedTasks) {
        const sourceTaskId = String(task?.sourceTaskId ?? "").trim();
        const status = canonicalStatusBySourceTaskId.get(sourceTaskId)?.status
            ?? normalizeEditableTaskStatus(String(task?.status ?? "backlog"));
        if (!sourceTaskId) continue;

        const existingRow: any = refreshedExistingBySourceTaskId.get(sourceTaskId);
        if (existingRow) {
            const updateData: Record<string, unknown> = {};
            if (String(existingRow.subject ?? "") !== String(task?.subject ?? "Untitled Task")) {
                updateData.subject = String(task?.subject ?? "Untitled Task");
            }
            if (String(existingRow.assignee ?? "") !== String(task?.assignee ?? "")) {
                updateData.assignee = String(task?.assignee ?? "");
            }
            if (Boolean(existingRow.isAi ?? false) !== Boolean(task?.isAi ?? false)) {
                updateData.isAi = Boolean(task?.isAi ?? false);
            }
            if (Number(existingRow.billableHoursToday ?? 0) !== Number(task?.billableHoursToday ?? 0)) {
                updateData.billableHoursToday = Number(task?.billableHoursToday ?? 0);
            }
            if (normalizeEditableTaskStatus(String(existingRow?.status ?? "backlog")) !== status) {
                updateData.status = status;
            }
            if (String(existingRow.week ?? "") !== week) {
                updateData.week = week;
            }

            if (Object.keys(updateData).length > 0) {
                await editableTaskModel.update({
                    where: { id: String(existingRow.id) },
                    data: updateData,
                });
            }
            continue;
        }

        const nextPosition = Number(positionByStatus.get(status) ?? 0) + 1;
        positionByStatus.set(status, nextPosition);

        await editableTaskModel.create({
            data: {
                week,
                scopeType: normalizedScopeType,
                scopeId: normalizedScopeId,
                sourceTaskId,
                subject: String(task?.subject ?? "Untitled Task"),
                description: String(task?.description ?? ""),
                assignee: String(task?.assignee ?? ""),
                isAi: Boolean(task?.isAi ?? false),
                billableHoursToday: Number(task?.billableHoursToday ?? 0),
                status,
                position: nextPosition,
            },
        });
    }

    const rows = await editableTaskModel.findMany({
        where: {
            week,
            scopeType: normalizedScopeType,
            scopeId: normalizedScopeId,
        },
        include: {
            attachments: {
                orderBy: [{ createdAt: "desc" }],
            },
            billableEntries: {
                orderBy: [
                    { entryDate: "desc" },
                    { createdAt: "desc" },
                ],
            },
        },
        orderBy: [
            { status: "asc" },
            { position: "asc" },
            { createdAt: "asc" },
        ],
    });

    return rows.map((row: any) => ({
        id: String(row.id),
        week: String(row.week),
        scopeType: String(row.scopeType),
        scopeId: String(row.scopeId),
        sourceTaskId: row.sourceTaskId ? String(row.sourceTaskId) : null,
        subject: String(row.subject ?? ""),
        description: String(row.description ?? ""),
        assignee: String(row.assignee ?? ""),
        isAi: Boolean(row.isAi ?? false),
        billableHoursToday: Number(row.billableHoursToday ?? 0),
        status: normalizeEditableTaskStatus(String(row.status ?? "backlog")),
        position: Number(row.position ?? 0),
        attachments: Array.isArray(row.attachments)
            ? row.attachments.map(mapEditableTaskAttachment)
            : [],
        billableEntries: Array.isArray(row.billableEntries)
            ? row.billableEntries.map(mapEditableTaskBillableEntry)
            : [],
    }));
}

export async function createEditableTask(input: {
    week: string;
    scopeType: string;
    scopeId: string;
    subject: string;
    description?: string;
    assignee?: string;
    isAi?: boolean;
    billableHoursToday?: number;
    status?: "backlog" | "open" | "closed";
}) {
    const editableTaskModel = (prisma as any).editableTask;
    if (!editableTaskModel) return null;

    const status = normalizeEditableTaskStatus(String(input.status ?? "backlog"));
    const lastInStatus = await editableTaskModel.findFirst({
        where: {
            week: String(input.week),
            scopeType: String(input.scopeType),
            scopeId: String(input.scopeId),
            status,
        },
        orderBy: {
            position: "desc",
        },
    });

    const created = await editableTaskModel.create({
        data: {
            week: String(input.week),
            scopeType: String(input.scopeType),
            scopeId: String(input.scopeId),
            subject: String(input.subject || "Untitled Task"),
            description: String(input.description ?? ""),
            assignee: String(input.assignee ?? ""),
            isAi: Boolean(input.isAi ?? false),
            billableHoursToday: Number(input.billableHoursToday ?? 0),
            status,
            position: Number(lastInStatus?.position ?? 0) + 1,
        },
    });

    revalidatePath("/");
    return {
        id: String(created.id),
        week: String(created.week),
        scopeType: String(created.scopeType),
        scopeId: String(created.scopeId),
        sourceTaskId: created.sourceTaskId ? String(created.sourceTaskId) : null,
        subject: String(created.subject ?? ""),
        description: String(created.description ?? ""),
        assignee: String(created.assignee ?? ""),
        isAi: Boolean(created.isAi ?? false),
        billableHoursToday: Number(created.billableHoursToday ?? 0),
        status: normalizeEditableTaskStatus(String(created.status ?? "backlog")),
        position: Number(created.position ?? 0),
        attachments: [],
        billableEntries: [],
    } satisfies EditableTaskRecord;
}

export async function updateEditableTask(
    taskId: string,
    data: Partial<{
        week: string;
        subject: string;
        description: string;
        assignee: string;
        isAi: boolean;
        billableHoursToday: number;
        status: "backlog" | "open" | "closed";
        position: number;
    }>
) {
    const editableTaskModel = (prisma as any).editableTask;
    if (!editableTaskModel) return;
    const currentTask = await editableTaskModel.findUnique({
        where: { id: String(taskId) },
        select: {
            id: true,
            week: true,
            sourceTaskId: true,
        },
    });

    const updateData: Record<string, unknown> = {};
    if (typeof data.week === "string") updateData.week = data.week;
    if (typeof data.subject === "string") updateData.subject = data.subject;
    if (typeof data.description === "string") updateData.description = data.description;
    if (typeof data.assignee === "string") updateData.assignee = data.assignee;
    if (typeof data.isAi === "boolean") updateData.isAi = data.isAi;
    if (typeof data.billableHoursToday === "number" && Number.isFinite(data.billableHoursToday)) updateData.billableHoursToday = data.billableHoursToday;
    if (typeof data.status === "string") updateData.status = normalizeEditableTaskStatus(data.status);
    if (typeof data.position === "number" && Number.isFinite(data.position)) updateData.position = data.position;

    await editableTaskModel.update({
        where: { id: taskId },
        data: updateData,
    });

    if (currentTask?.sourceTaskId && typeof updateData.status === "string") {
        await editableTaskModel.updateMany({
            where: {
                week: String(currentTask.week),
                sourceTaskId: String(currentTask.sourceTaskId),
                id: {
                    not: String(taskId),
                },
            },
            data: {
                status: updateData.status,
            },
        });
    }

    revalidatePath("/");
}

export async function deleteEditableTask(taskId: string) {
    const editableTaskModel = (prisma as any).editableTask;
    const taskAttachmentModel = (prisma as any).taskAttachment;
    if (!editableTaskModel) return;

    if (taskAttachmentModel) {
        const attachments = await taskAttachmentModel.findMany({
            where: { taskId: String(taskId) },
        });

        await Promise.all(
            attachments.map((attachment: any) =>
                unlink(path.join(getTaskAttachmentStorageDir(), String(attachment.storedName))).catch(() => undefined)
            )
        );
    }

    await editableTaskModel.delete({
        where: { id: taskId },
    });

    revalidatePath("/");
}

export async function deleteEditableTaskAttachment(attachmentId: string) {
    const taskAttachmentModel = (prisma as any).taskAttachment;
    if (!taskAttachmentModel) return;

    const existing = await taskAttachmentModel.findUnique({
        where: { id: String(attachmentId) },
    });
    if (!existing) return;

    await taskAttachmentModel.delete({
        where: { id: String(attachmentId) },
    });

    await unlink(path.join(getTaskAttachmentStorageDir(), String(existing.storedName))).catch(() => undefined);
    revalidatePath("/");
}

export async function addEditableTaskBillableEntry(input: {
    taskId: string;
    entryDate: string;
    hours: number;
    note?: string;
    isValueAdd?: boolean;
}) {
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    const editableTaskModel = (prisma as any).editableTask;
    if (!taskBillableEntryModel || !editableTaskModel) return null;

    const taskId = String(input.taskId || "").trim();
    const entryDate = String(input.entryDate || "").trim();
    const hours = Number(input.hours ?? 0);
    if (!taskId || !entryDate || !Number.isFinite(hours)) return null;

    const created = await taskBillableEntryModel.create({
        data: {
            taskId,
            entryDate,
            hours,
            note: String(input.note ?? ""),
            isValueAdd: Boolean(input.isValueAdd ?? false),
        },
    });

    const entryDatePrefix = entryDate.slice(0, 10);
    const todayHours = await taskBillableEntryModel.aggregate({
        where: {
            taskId,
            entryDate: entryDatePrefix,
        },
        _sum: {
            hours: true,
        },
    });

    await editableTaskModel.update({
        where: { id: taskId },
        data: {
            billableHoursToday: Number(todayHours?._sum?.hours ?? 0),
        },
    });

    revalidatePath("/");
    return mapEditableTaskBillableEntry(created);
}

export async function updateEditableTaskBillableEntry(
    entryId: string,
    data: Partial<{
        isValueAdd: boolean;
        note: string;
        hours: number;
        entryDate: string;
    }>
) {
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    const editableTaskModel = (prisma as any).editableTask;
    if (!taskBillableEntryModel || !editableTaskModel) return null;

    const existing = await taskBillableEntryModel.findUnique({
        where: { id: String(entryId) },
    });
    if (!existing) return null;

    const updateData: Record<string, unknown> = {};
    if (typeof data.isValueAdd === "boolean") updateData.isValueAdd = data.isValueAdd;
    if (typeof data.note === "string") updateData.note = data.note;
    if (typeof data.entryDate === "string" && data.entryDate.trim().length > 0) updateData.entryDate = data.entryDate.trim();
    if (typeof data.hours === "number" && Number.isFinite(data.hours)) updateData.hours = data.hours;

    const updated = await taskBillableEntryModel.update({
        where: { id: String(entryId) },
        data: updateData,
    });

    const currentEntryDate = String(updated.entryDate);
    const todayHours = await taskBillableEntryModel.aggregate({
        where: {
            taskId: String(updated.taskId),
            entryDate: currentEntryDate,
        },
        _sum: {
            hours: true,
        },
    });

    await editableTaskModel.update({
        where: { id: String(updated.taskId) },
        data: {
            billableHoursToday: Number(todayHours?._sum?.hours ?? 0),
        },
    });

    revalidatePath("/");
    return mapEditableTaskBillableEntry(updated);
}

export async function deleteEditableTaskBillableEntry(entryId: string) {
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    const editableTaskModel = (prisma as any).editableTask;
    if (!taskBillableEntryModel || !editableTaskModel) return;

    const existing = await taskBillableEntryModel.findUnique({
        where: { id: String(entryId) },
    });
    if (!existing) return;

    await taskBillableEntryModel.delete({
        where: { id: String(entryId) },
    });

    const remainingForDay = await taskBillableEntryModel.aggregate({
        where: {
            taskId: String(existing.taskId),
            entryDate: String(existing.entryDate),
        },
        _sum: {
            hours: true,
        },
    });

    await editableTaskModel.update({
        where: { id: String(existing.taskId) },
        data: {
            billableHoursToday: Number(remainingForDay?._sum?.hours ?? 0),
        },
    });

    revalidatePath("/");
}

export async function getEditableTaskBillableRollups(week: string): Promise<EditableTaskBillableRollupRecord[]> {
    const editableTaskModel = (prisma as any).editableTask;
    if (!editableTaskModel) return [];

    const range = getWeekDateRange(week);
    const rows = await editableTaskModel.findMany({
        include: {
            billableEntries: {
                where: {
                    entryDate: {
                        gte: range.startKey,
                        lte: range.endKey,
                    },
                },
            },
        },
    });

    const rollups = new Map<string, EditableTaskBillableRollupRecord>();
    rows.forEach((row: any) => {
        const assignee = String(row?.assignee ?? "").trim();
        if (!assignee) return;

        const hours = Array.isArray(row?.billableEntries)
            ? row.billableEntries.reduce((sum: number, entry: any) => sum + Number(entry?.hours ?? 0), 0)
            : 0;
        if (hours <= 0) return;

        const scopeType = String(row?.scopeType ?? "");
        const scopeId = String(row?.scopeId ?? "");
        const sourceTaskId = String(row?.sourceTaskId ?? "").trim() || null;
        const key = `${scopeType}|${scopeId}|${normalizeName(assignee)}|${sourceTaskId ?? ""}`;
        const current = rollups.get(key);
        if (current) {
            current.hours += hours;
            return;
        }
        rollups.set(key, {
            scopeType,
            scopeId,
            assignee,
            hours,
            sourceTaskId,
        });
    });

    return Array.from(rollups.values()).map((row) => ({
        ...row,
        hours: Number(row.hours.toFixed(2)),
    }));
}

export async function ensureInternalTimeWorkspace() {
    const clientDirectoryModel = (prisma as any).clientDirectory;
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    if (!clientDirectoryModel || !taskSidebarFolderModel || !taskSidebarBoardModel || !taskSidebarBoardPlacementModel) return;

    await clientDirectoryModel.upsert({
        where: { id: "ndi-internal" },
        update: {
            name: "NDI Internal",
            isActive: true,
            isInternal: true,
            sortOrder: -100,
        },
        create: {
            id: "ndi-internal",
            name: "NDI Internal",
            isActive: true,
            isInternal: true,
            sortOrder: -100,
        },
    });

    let folder = await taskSidebarFolderModel.findFirst({
        where: { name: "NDI Internal" },
    });

    if (!folder) {
        folder = await taskSidebarFolderModel.create({
            data: {
                name: "NDI Internal",
                orderIndex: -100,
            },
        });
    }

    const internalBoards = [
        "Project 68 (Internal Cap)",
        "Project 77 (Internal Non-Cap)",
        "Sales",
    ];

    for (let index = 0; index < internalBoards.length; index += 1) {
        const boardName = internalBoards[index];
        let board = await taskSidebarBoardModel.findFirst({
            where: {
                parentFolderId: String(folder.id),
                name: boardName,
            },
        });

        if (!board) {
            board = await taskSidebarBoardModel.create({
                data: {
                    name: boardName,
                    parentFolderId: String(folder.id),
                    orderIndex: index,
                },
            });
        }

        await taskSidebarBoardPlacementModel.upsert({
            where: {
                source_boardId: {
                    source: "local",
                    boardId: String(board.id),
                },
            },
            update: {
                boardName,
                clientId: "ndi-internal",
                clientName: "NDI Internal",
                parentFolderId: String(folder.id),
                orderIndex: index,
            },
            create: {
                source: "local",
                boardId: String(board.id),
                boardName,
                clientId: "ndi-internal",
                clientName: "NDI Internal",
                parentFolderId: String(folder.id),
                orderIndex: index,
            },
        });
    }
}

export async function getTaskSidebarStructure(): Promise<TaskSidebarStructureRecord> {
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    const taskSidebarFolderOverrideModel = (prisma as any).taskSidebarFolderOverride;
    const taskSidebarHiddenFolderModel = (prisma as any).taskSidebarHiddenFolder;
    const taskSidebarHiddenBoardModel = (prisma as any).taskSidebarHiddenBoard;
    if (!taskSidebarFolderModel || !taskSidebarBoardModel) {
        return { folders: [], boards: [], placements: [], folderOverrides: [], hiddenFolderIds: [], hiddenBoardIds: [] };
    }

    await ensureInternalTimeWorkspace();

    const [folders, boards, placements, folderOverrides, hiddenFolders, hiddenBoards] = await Promise.all([
        taskSidebarFolderModel.findMany({
            orderBy: [
                { orderIndex: "asc" },
                { createdAt: "asc" },
            ],
        }),
        taskSidebarBoardModel.findMany({
            orderBy: [
                { parentFolderId: "asc" },
                { orderIndex: "asc" },
                { createdAt: "asc" },
            ],
        }),
        taskSidebarBoardPlacementModel?.findMany?.({
            orderBy: [
                { parentFolderId: "asc" },
                { orderIndex: "asc" },
                { createdAt: "asc" },
            ],
        }) ?? [],
        taskSidebarFolderOverrideModel?.findMany?.({
            orderBy: [
                { source: "asc" },
                { createdAt: "asc" },
            ],
        }) ?? [],
        taskSidebarHiddenFolderModel?.findMany?.({
            orderBy: { createdAt: "asc" },
        }) ?? [],
        taskSidebarHiddenBoardModel?.findMany?.({
            orderBy: { createdAt: "asc" },
        }) ?? [],
    ]);

    return {
        folders: folders.map((row: any) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            orderIndex: Number(row.orderIndex ?? 0),
        })),
        boards: boards.map((row: any) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            parentFolderId: String(row.parentFolderId ?? ""),
            orderIndex: Number(row.orderIndex ?? 0),
            clientId: null,
            clientName: null,
        })),
        placements: placements.map((row: any) => ({
            boardId: String(row.boardId ?? ""),
            source: String(row.source ?? "clickup") === "local" ? "local" : "clickup",
            boardName: row.boardName == null ? null : String(row.boardName),
            clientId: row.clientId == null ? null : String(row.clientId),
            clientName: row.clientName == null ? null : String(row.clientName),
            parentFolderId: String(row.parentFolderId ?? ""),
            orderIndex: Number(row.orderIndex ?? 0),
        })).filter((row: TaskSidebarBoardPlacementRecord) => row.boardId.length > 0),
        folderOverrides: folderOverrides.map((row: any) => ({
            folderId: String(row.folderId ?? ""),
            source: String(row.source ?? "clickup") === "local" ? "local" : "clickup",
            name: String(row.name ?? ""),
        })).filter((row: TaskSidebarFolderOverrideRecord) => row.folderId.length > 0 && row.name.length > 0),
        hiddenFolderIds: hiddenFolders.map((row: any) => String(row.folderId ?? "")).filter(Boolean),
        hiddenBoardIds: hiddenBoards.map((row: any) => String(row.boardId ?? "")).filter(Boolean),
    };
}

export async function createTaskSidebarFolder(name: string) {
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    if (!taskSidebarFolderModel) return null;

    const trimmed = String(name || "").trim();
    if (!trimmed) return null;

    const lastFolder = await taskSidebarFolderModel.findFirst({
        orderBy: { orderIndex: "desc" },
    });

    const created = await taskSidebarFolderModel.create({
        data: {
            name: trimmed,
            orderIndex: Number(lastFolder?.orderIndex ?? 0) + 1,
        },
    });

    revalidatePath("/");
    return {
        id: String(created.id),
        name: String(created.name ?? ""),
        orderIndex: Number(created.orderIndex ?? 0),
    } satisfies TaskSidebarFolderRecord;
}

export async function createTaskSidebarBoard(input: { parentFolderId: string; name: string; clientId: string; clientName: string }) {
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    if (!taskSidebarBoardModel || !taskSidebarBoardPlacementModel) return null;

    const parentFolderId = String(input.parentFolderId || "").trim();
    const trimmed = String(input.name || "").trim();
    const clientId = String(input.clientId || "").trim();
    const clientName = String(input.clientName || "").trim();
    if (!parentFolderId || !trimmed || !clientId || !clientName) return null;

    const lastBoard = await taskSidebarBoardModel.findFirst({
        where: { parentFolderId },
        orderBy: { orderIndex: "desc" },
    });

    const created = await taskSidebarBoardModel.create({
        data: {
            parentFolderId,
            name: trimmed,
            orderIndex: Number(lastBoard?.orderIndex ?? 0) + 1,
        },
    });

    await taskSidebarBoardPlacementModel.create({
        data: {
            boardId: String(created.id),
            source: "local",
            boardName: trimmed,
            clientId,
            clientName,
            parentFolderId,
            orderIndex: Number(created.orderIndex ?? 0),
        },
    });

    revalidatePath("/");
    return {
        id: String(created.id),
        name: String(created.name ?? ""),
        parentFolderId: String(created.parentFolderId ?? ""),
        orderIndex: Number(created.orderIndex ?? 0),
        clientId,
        clientName,
    } satisfies TaskSidebarBoardRecord;
}

export async function saveTaskSidebarBoardLayout(input: {
    folders: Array<{
        folderId: string;
        boards: Array<{
            boardId: string;
            boardName?: string | null;
            clientId?: string | null;
            clientName?: string | null;
            source: "clickup" | "local";
        }>;
    }>;
}) {
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    if (!taskSidebarBoardModel || !taskSidebarBoardPlacementModel) return null;

    const folders = (input.folders ?? [])
        .map((folder) => ({
            folderId: String(folder.folderId ?? "").trim(),
            boards: (folder.boards ?? []).map((board) => ({
                boardId: String(board.boardId ?? "").trim(),
                boardName: board.boardName == null ? null : String(board.boardName),
                clientId: board.clientId == null ? null : String(board.clientId),
                clientName: board.clientName == null ? null : String(board.clientName),
                source: String(board.source ?? "clickup") === "local" ? "local" as const : "clickup" as const,
            })).filter((board) => board.boardId.length > 0),
        }))
        .filter((folder) => folder.folderId.length > 0);

    if (folders.length === 0) return null;

    for (const folder of folders) {
        for (let index = 0; index < folder.boards.length; index += 1) {
            const board = folder.boards[index];
            await taskSidebarBoardPlacementModel.upsert({
                where: {
                    source_boardId: {
                        source: board.source,
                        boardId: board.boardId,
                    },
                },
                update: {
                    boardName: board.boardName,
                    clientId: board.clientId,
                    clientName: board.clientName,
                    parentFolderId: folder.folderId,
                    orderIndex: index,
                },
                create: {
                    source: board.source,
                    boardId: board.boardId,
                    boardName: board.boardName,
                    clientId: board.clientId,
                    clientName: board.clientName,
                    parentFolderId: folder.folderId,
                    orderIndex: index,
                },
            });

            if (board.source === "local") {
                await taskSidebarBoardModel.update({
                    where: { id: board.boardId },
                    data: {
                        parentFolderId: folder.folderId,
                        orderIndex: index,
                    },
                });
            }
        }
    }

    revalidatePath("/");
    return { ok: true };
}

export async function updateTaskSidebarBoard(input: {
    boardId: string;
    source: "clickup" | "local";
    parentFolderId: string;
    name: string;
    clientId: string;
    clientName: string;
}) {
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    if (!taskSidebarBoardModel || !taskSidebarBoardPlacementModel) return null;

    const boardId = String(input.boardId || "").trim();
    const parentFolderId = String(input.parentFolderId || "").trim();
    const name = String(input.name || "").trim();
    const clientId = String(input.clientId || "").trim();
    const clientName = String(input.clientName || "").trim();
    const source = String(input.source || "clickup") === "local" ? "local" as const : "clickup" as const;
    if (!boardId || !parentFolderId || !name || !clientId || !clientName) return null;

    const existingPlacement = await taskSidebarBoardPlacementModel.findUnique({
        where: {
            source_boardId: {
                source,
                boardId,
            },
        },
    });

    await taskSidebarBoardPlacementModel.upsert({
        where: {
            source_boardId: {
                source,
                boardId,
            },
        },
        update: {
            boardName: name,
            clientId,
            clientName,
            parentFolderId,
            orderIndex: Number(existingPlacement?.orderIndex ?? 0),
        },
        create: {
            source,
            boardId,
            boardName: name,
            clientId,
            clientName,
            parentFolderId,
            orderIndex: Number(existingPlacement?.orderIndex ?? 0),
        },
    });

    if (source === "local") {
        await taskSidebarBoardModel.update({
            where: { id: boardId },
            data: { name },
        });
    }

    revalidatePath("/");
    return { boardId, name, clientId, clientName };
}

export async function updateTaskSidebarFolder(input: {
    folderId: string;
    source: "clickup" | "local";
    name: string;
}) {
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    const taskSidebarFolderOverrideModel = (prisma as any).taskSidebarFolderOverride;
    if (!taskSidebarFolderModel || !taskSidebarFolderOverrideModel) return null;

    const folderId = String(input.folderId || "").trim();
    const name = String(input.name || "").trim();
    const source = String(input.source || "clickup") === "local" ? "local" as const : "clickup" as const;
    if (!folderId || !name) return null;

    await taskSidebarFolderOverrideModel.upsert({
        where: {
            source_folderId: {
                source,
                folderId,
            },
        },
        update: { name },
        create: {
            source,
            folderId,
            name,
        },
    });

    if (source === "local") {
        await taskSidebarFolderModel.update({
            where: { id: folderId },
            data: { name },
        });
    }

    revalidatePath("/");
    return { folderId, name };
}

export async function deleteTaskSidebarBoard(boardId: string) {
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const editableTaskModel = (prisma as any).editableTask;
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    const taskSidebarHiddenBoardModel = (prisma as any).taskSidebarHiddenBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    if (!taskSidebarBoardModel || !editableTaskModel || !taskBillableEntryModel) return;

    const existingBoard = await taskSidebarBoardModel.findUnique({
        where: { id: String(boardId) },
    });
    if (!existingBoard) return;

    const boardTasks = await editableTaskModel.findMany({
        where: {
            scopeType: "list",
            scopeId: String(boardId),
        },
        select: { id: true },
    });

    const taskIds = boardTasks.map((task: any) => String(task.id));
    if (taskIds.length > 0) {
        await taskBillableEntryModel.deleteMany({
            where: {
                taskId: {
                    in: taskIds,
                },
            },
        });
        await editableTaskModel.deleteMany({
            where: {
                id: {
                    in: taskIds,
                },
            },
        });
    }

    await taskSidebarBoardModel.delete({
        where: { id: String(boardId) },
    });

    if (taskSidebarHiddenBoardModel) {
        await taskSidebarHiddenBoardModel.deleteMany({
            where: { boardId: String(boardId) },
        });
    }

    if (taskSidebarBoardPlacementModel) {
        await taskSidebarBoardPlacementModel.deleteMany({
            where: {
                OR: [
                    { boardId: String(boardId) },
                    { source: "local", boardId: String(boardId) },
                ],
            },
        });
    }

    revalidatePath("/");
}

export async function hideTaskSidebarBoard(boardId: string) {
    const taskSidebarHiddenBoardModel = (prisma as any).taskSidebarHiddenBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    if (!taskSidebarHiddenBoardModel) return;

    const trimmed = String(boardId || "").trim();
    if (!trimmed) return;

    await taskSidebarHiddenBoardModel.upsert({
        where: { boardId: trimmed },
        update: {},
        create: {
            boardId: trimmed,
        },
    });

    if (taskSidebarBoardPlacementModel) {
        await taskSidebarBoardPlacementModel.deleteMany({
            where: { boardId: trimmed },
        });
    }

    revalidatePath("/");
}

export async function removeTaskSidebarBoard(boardId: string) {
    const trimmed = String(boardId || "").trim();
    if (!trimmed) return;

    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    if (!taskSidebarBoardModel) return;

    const existingBoard = await taskSidebarBoardModel.findUnique({
        where: { id: trimmed },
        select: { id: true },
    });

    if (existingBoard) {
        await deleteTaskSidebarBoard(trimmed);
        return;
    }

    await hideTaskSidebarBoard(trimmed);
}

export async function deleteTaskSidebarFolder(folderId: string) {
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    const taskSidebarFolderOverrideModel = (prisma as any).taskSidebarFolderOverride;
    const editableTaskModel = (prisma as any).editableTask;
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    if (!taskSidebarFolderModel || !taskSidebarBoardModel || !editableTaskModel || !taskBillableEntryModel) return;

    const folderBoards = await taskSidebarBoardModel.findMany({
        where: { parentFolderId: String(folderId) },
        select: { id: true },
    });
    const boardIds = folderBoards.map((board: any) => String(board.id));

    const folderTasks = await editableTaskModel.findMany({
        where: {
            OR: [
                { scopeType: "folder", scopeId: String(folderId) },
                ...(boardIds.length > 0 ? [{ scopeType: "list", scopeId: { in: boardIds } }] : []),
            ],
        },
        select: { id: true },
    });
    const taskIds = folderTasks.map((task: any) => String(task.id));

    if (taskIds.length > 0) {
        await taskBillableEntryModel.deleteMany({
            where: {
                taskId: {
                    in: taskIds,
                },
            },
        });
        await editableTaskModel.deleteMany({
            where: {
                id: {
                    in: taskIds,
                },
            },
        });
    }

    if (boardIds.length > 0) {
        await taskSidebarBoardModel.deleteMany({
            where: {
                id: {
                    in: boardIds,
                },
            },
        });
    }

    if (taskSidebarBoardPlacementModel) {
        await taskSidebarBoardPlacementModel.deleteMany({
            where: {
                OR: [
                    { parentFolderId: String(folderId) },
                    ...(boardIds.length > 0 ? [{ source: "local", boardId: { in: boardIds } }] : []),
                ],
            },
        });
    }

    await taskSidebarFolderModel.delete({
        where: { id: String(folderId) },
    });

    if (taskSidebarFolderOverrideModel) {
        await taskSidebarFolderOverrideModel.deleteMany({
            where: {
                OR: [
                    { folderId: String(folderId) },
                    { source: "local", folderId: String(folderId) },
                ],
            },
        });
    }

    revalidatePath("/");
}

export async function hideTaskSidebarFolder(folderId: string) {
    const taskSidebarHiddenFolderModel = (prisma as any).taskSidebarHiddenFolder;
    const taskSidebarBoardPlacementModel = (prisma as any).taskSidebarBoardPlacement;
    const taskSidebarFolderOverrideModel = (prisma as any).taskSidebarFolderOverride;
    if (!taskSidebarHiddenFolderModel) return;

    const trimmed = String(folderId || "").trim();
    if (!trimmed) return;

    await taskSidebarHiddenFolderModel.upsert({
        where: { folderId: trimmed },
        update: {},
        create: {
            folderId: trimmed,
        },
    });

    if (taskSidebarBoardPlacementModel) {
        await taskSidebarBoardPlacementModel.deleteMany({
            where: { parentFolderId: trimmed },
        });
    }

    if (taskSidebarFolderOverrideModel) {
        await taskSidebarFolderOverrideModel.deleteMany({
            where: { folderId: trimmed },
        });
    }

    revalidatePath("/");
}

export async function removeTaskSidebarFolder(folderId: string) {
    const trimmed = String(folderId || "").trim();
    if (!trimmed) return;

    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    if (!taskSidebarFolderModel) return;

    const existingFolder = await taskSidebarFolderModel.findUnique({
        where: { id: trimmed },
        select: { id: true },
    });

    if (existingFolder) {
        await deleteTaskSidebarFolder(trimmed);
        return;
    }

    await hideTaskSidebarFolder(trimmed);
}
