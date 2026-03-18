"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { addDays } from "date-fns";

export interface CapacityGridResource {
    id: string;
    name: string;
    orderIndex: number;
    consultantId?: number | null;
    removed?: boolean;
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

export interface EditableTaskSeed {
    sourceTaskId: string;
    subject: string;
    description?: string;
    assignee?: string;
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
    billableHoursToday: number;
    status: "backlog" | "open" | "closed";
    position: number;
    billableEntries: EditableTaskBillableEntryRecord[];
}

export interface EditableTaskBillableEntryRecord {
    id: string;
    taskId: string;
    entryDate: string;
    hours: number;
    note: string;
    createdAt: string;
    updatedAt: string;
}

export interface EditableTaskBillableRollupRecord {
    scopeType: string;
    scopeId: string;
    assignee: string;
    hours: number;
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
}

export interface TaskSidebarStructureRecord {
    folders: TaskSidebarFolderRecord[];
    boards: TaskSidebarBoardRecord[];
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

function mapEditableTaskBillableEntry(row: any): EditableTaskBillableEntryRecord {
    return {
        id: String(row.id),
        taskId: String(row.taskId),
        entryDate: String(row.entryDate ?? ""),
        hours: Number(row.hours ?? 0),
        note: String(row.note ?? ""),
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
        // Seed wkMax from Command Center week target as requested.
        wkMax: Number(cc.target ?? 0),
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
        const aligned = parsed.resources.length === 0 && consultants && consultants.length > 0
            ? remapCapacityPayloadToResources(parsed, rosterResources)
            : consultants && consultants.length > 0
            ? mergeCapacityPayloadWithRoster(parsed, rosterResources)
            : parsed;
        const wkMaxApplied = await applyInitialWkMaxFromTarget(week, aligned);
        const teamApplied = await applyInitialTeamFromClientConfig(week, wkMaxApplied.payload);

        const hasResourceDiff =
            JSON.stringify(teamApplied.payload.resources) !== JSON.stringify(parsed.resources) ||
            JSON.stringify(teamApplied.payload.rows.map((r) => Object.keys(r.allocations).sort())) !== JSON.stringify(parsed.rows.map((r) => Object.keys(r.allocations).sort()));

        if (hasResourceDiff || wkMaxApplied.changed || teamApplied.changed) {
            await capacityGridModel.update({
                where: { week },
                data: {
                    resourcesJson: JSON.stringify(teamApplied.payload.resources),
                    rowsJson: JSON.stringify(teamApplied.payload.rows),
                },
            });
        }

        return teamApplied.payload;
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

    const stalePlaceholderIds = existingRows
        .filter((row: any) => {
            const sourceTaskId = String(row?.sourceTaskId ?? "").trim();
            return sourceTaskId && !allowedSourceTaskIds.has(sourceTaskId);
        })
        .map((row: any) => String(row.id));

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
        const status = normalizeEditableTaskStatus(String(task?.status ?? "backlog"));
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
        billableHoursToday: Number(row.billableHoursToday ?? 0),
        status: normalizeEditableTaskStatus(String(row.status ?? "backlog")),
        position: Number(row.position ?? 0),
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
        billableHoursToday: Number(created.billableHoursToday ?? 0),
        status: normalizeEditableTaskStatus(String(created.status ?? "backlog")),
        position: Number(created.position ?? 0),
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
        billableHoursToday: number;
        status: "backlog" | "open" | "closed";
        position: number;
    }>
) {
    const editableTaskModel = (prisma as any).editableTask;
    if (!editableTaskModel) return;

    const updateData: Record<string, unknown> = {};
    if (typeof data.week === "string") updateData.week = data.week;
    if (typeof data.subject === "string") updateData.subject = data.subject;
    if (typeof data.description === "string") updateData.description = data.description;
    if (typeof data.assignee === "string") updateData.assignee = data.assignee;
    if (typeof data.billableHoursToday === "number" && Number.isFinite(data.billableHoursToday)) updateData.billableHoursToday = data.billableHoursToday;
    if (typeof data.status === "string") updateData.status = normalizeEditableTaskStatus(data.status);
    if (typeof data.position === "number" && Number.isFinite(data.position)) updateData.position = data.position;

    await editableTaskModel.update({
        where: { id: taskId },
        data: updateData,
    });

    revalidatePath("/");
}

export async function deleteEditableTask(taskId: string) {
    const editableTaskModel = (prisma as any).editableTask;
    if (!editableTaskModel) return;

    await editableTaskModel.delete({
        where: { id: taskId },
    });

    revalidatePath("/");
}

export async function addEditableTaskBillableEntry(input: {
    taskId: string;
    entryDate: string;
    hours: number;
    note?: string;
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
        const key = `${scopeType}|${scopeId}|${normalizeName(assignee)}`;
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
        });
    });

    return Array.from(rollups.values()).map((row) => ({
        ...row,
        hours: Number(row.hours.toFixed(2)),
    }));
}

export async function getTaskSidebarStructure(): Promise<TaskSidebarStructureRecord> {
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const taskSidebarHiddenBoardModel = (prisma as any).taskSidebarHiddenBoard;
    if (!taskSidebarFolderModel || !taskSidebarBoardModel) {
        return { folders: [], boards: [], hiddenBoardIds: [] };
    }

    const [folders, boards, hiddenBoards] = await Promise.all([
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
        })),
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

export async function createTaskSidebarBoard(input: { parentFolderId: string; name: string }) {
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    if (!taskSidebarBoardModel) return null;

    const parentFolderId = String(input.parentFolderId || "").trim();
    const trimmed = String(input.name || "").trim();
    if (!parentFolderId || !trimmed) return null;

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

    revalidatePath("/");
    return {
        id: String(created.id),
        name: String(created.name ?? ""),
        parentFolderId: String(created.parentFolderId ?? ""),
        orderIndex: Number(created.orderIndex ?? 0),
    } satisfies TaskSidebarBoardRecord;
}

export async function deleteTaskSidebarBoard(boardId: string) {
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
    const editableTaskModel = (prisma as any).editableTask;
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    const taskSidebarHiddenBoardModel = (prisma as any).taskSidebarHiddenBoard;
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

    revalidatePath("/");
}

export async function hideTaskSidebarBoard(boardId: string) {
    const taskSidebarHiddenBoardModel = (prisma as any).taskSidebarHiddenBoard;
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

    revalidatePath("/");
}

export async function deleteTaskSidebarFolder(folderId: string) {
    const taskSidebarFolderModel = (prisma as any).taskSidebarFolder;
    const taskSidebarBoardModel = (prisma as any).taskSidebarBoard;
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

    await taskSidebarFolderModel.delete({
        where: { id: String(folderId) },
    });

    revalidatePath("/");
}
