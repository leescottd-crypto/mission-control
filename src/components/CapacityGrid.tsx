"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import {
    CapacityGridAllocation,
    CapacityGridPayload,
    CapacityGridResource,
    CapacityGridRow,
    EditableTaskBillableRollupRecord,
    updateCapacityGridConfig
} from "@/app/actions";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Grid2x2, Plus, Save, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClickUpTask } from "@/lib/clickup";
import type { FolderWithLists } from "@/components/Sidebar";

interface CapacityGridProps {
    activeWeekStr: string;
    initialGrid: CapacityGridPayload;
    onGridChange?: (nextGrid: CapacityGridPayload) => void;
    consultants?: Array<{ id: number; name: string }>;
    consultantConfigsById?: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>;
    tasks?: ClickUpTask[];
    folders?: FolderWithLists[];
    activeAssigneeFilter?: string | null;
    billableRollups?: EditableTaskBillableRollupRecord[];
}

function toNumber(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizeName(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clientIdFromName(value: string) {
    const normalized = normalizeName(value);
    return normalized.length > 0 ? normalized : `client-${Date.now()}`;
}

function roundToHalfStep(value: number) {
    return Math.round(value * 2) / 2;
}

function clampNonNegative(value: number) {
    return Math.max(0, value);
}

function sanitizeCapacityRows(rows: CapacityGridRow[] = []): CapacityGridRow[] {
    return rows.map((row) => ({
        ...row,
        team: clampNonNegative(Number(row.team ?? 0)),
        wkMin: clampNonNegative(Number(row.wkMin ?? 0)),
        wkMax: clampNonNegative(Number(row.wkMax ?? 0)),
        allocations: Object.fromEntries(
            Object.entries(row.allocations ?? {}).map(([resourceId, allocation]) => [
                resourceId,
                {
                    ...allocation,
                    hours: clampNonNegative(Number(allocation?.hours ?? 0)),
                },
            ])
        ),
    }));
}

type ClickUpCellMetrics = {
    planned: number;
    actuals: number;
};

type AllocationNoteEditorState = {
    rowId: string;
    resourceId: string;
    clientName: string;
    consultantName: string;
    note: string;
};

type RemoveClientConfirmState = {
    rowId: string;
    clientName: string;
};

const clientHeaderStickyClass = "sticky left-0 z-50 bg-[#111626] shadow-[6px_0_8px_-8px_rgba(15,23,42,0.9)]";
const clientBodyStickyClass = "sticky left-0 z-20 bg-[#0f1529] shadow-[6px_0_8px_-8px_rgba(15,23,42,0.9)]";
const clientFooterStickyClass = "sticky left-0 z-20 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.9)]";
const headerTopRowStickyClass = "sticky top-0 z-40 bg-[#111626]";
const monochromeMetricCardClass = "rounded-[22px] border border-border/50 bg-[linear-gradient(180deg,rgba(23,27,39,0.92)_0%,rgba(13,18,29,0.92)_100%)] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]";

export function CapacityGrid({
    activeWeekStr,
    initialGrid,
    onGridChange,
    consultants = [],
    consultantConfigsById = {},
    tasks = [],
    folders = [],
    activeAssigneeFilter = null,
    billableRollups = [],
}: CapacityGridProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [isWeekNavLocked, setIsWeekNavLocked] = useState(false);

    const [resources, setResources] = useState<CapacityGridResource[]>(initialGrid?.resources ?? []);
    const [rows, setRows] = useState<CapacityGridRow[]>(sanitizeCapacityRows(initialGrid?.rows ?? []));
    const [consultantConfigs, setConsultantConfigs] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(consultantConfigsById);
    const [noteEditor, setNoteEditor] = useState<AllocationNoteEditorState | null>(null);
    const [removeClientConfirm, setRemoveClientConfirm] = useState<RemoveClientConfirmState | null>(null);
    const initializedWeekRef = useRef<string>("");
    const autoFillRunKeyRef = useRef<string>("");
    const navUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gridScrollRef = useRef<HTMLDivElement | null>(null);
    const restoredViewKeyRef = useRef<string>("");

    useEffect(() => {
        // Prevent render loops: only rehydrate local grid state when week changes.
        if (initializedWeekRef.current === activeWeekStr) return;
        initializedWeekRef.current = activeWeekStr;
        setResources(initialGrid?.resources ?? []);
        setRows(sanitizeCapacityRows(initialGrid?.rows ?? []));
    }, [activeWeekStr, initialGrid?.resources, initialGrid?.rows]);

    useEffect(() => {
        setConsultantConfigs(consultantConfigsById);
    }, [activeWeekStr, consultantConfigsById]);

    const visibleResources = useMemo(
        () => resources.filter((resource) => !resource.removed),
        [resources]
    );

    const activeWeekDate = useMemo(() => new Date(activeWeekStr + "T00:00:00"), [activeWeekStr]);
    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=capacity-grid`;
    const buildCapacityReturnTo = useCallback((rowId?: string | null, resourceId?: string | null) => {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("tab", "capacity-grid");
        params.set("week", activeWeekStr);
        const scrollLeft = Number(gridScrollRef.current?.scrollLeft ?? 0);
        const scrollTop = Number(gridScrollRef.current?.scrollTop ?? 0);
        params.set("gridScrollLeft", String(Math.round(scrollLeft)));
        params.set("gridScrollTop", String(Math.round(scrollTop)));
        if (rowId) {
            params.set("gridRowId", rowId);
        }
        if (resourceId) {
            params.set("gridResourceId", resourceId);
        }
        return `${pathname}?${params.toString()}`;
    }, [activeWeekStr, pathname, searchParams]);

    const resolveClientBoardHref = useCallback((row: CapacityGridRow, resource: CapacityGridResource, consultantName?: string | null) => {
        const clientName = row.client;
        const normalizedClient = normalizeName(clientName);
        if (!normalizedClient) return null;
        const returnToParam = `&returnTo=${encodeURIComponent(buildCapacityReturnTo(row.id, resource.id))}`;
        const assigneeParam = consultantName && consultantName.trim().length > 0
            ? `&assignee=${encodeURIComponent(consultantName.trim())}`
            : activeAssigneeFilter && activeAssigneeFilter.trim().length > 0
                ? `&assignee=${encodeURIComponent(activeAssigneeFilter.trim())}`
                : "";

        const exactList = folders.flatMap((folder) =>
            folder.lists.map((list) => ({
                type: "list" as const,
                id: list.id,
                name: list.name,
                folderId: folder.id,
                folderName: folder.name,
            }))
        ).find((entry) => normalizeName(entry.name) === normalizedClient);

        if (exactList) {
            return `/?week=${activeWeekStr}&tab=issues&listId=${encodeURIComponent(exactList.id)}${assigneeParam}${returnToParam}`;
        }

        const fuzzyList = folders.flatMap((folder) =>
            folder.lists.map((list) => ({
                type: "list" as const,
                id: list.id,
                name: list.name,
                folderId: folder.id,
                folderName: folder.name,
            }))
        ).find((entry) => {
            const entryName = normalizeName(entry.name);
            return entryName.includes(normalizedClient) || normalizedClient.includes(entryName);
        });

        if (fuzzyList) {
            return `/?week=${activeWeekStr}&tab=issues&listId=${encodeURIComponent(fuzzyList.id)}${assigneeParam}${returnToParam}`;
        }

        const exactFolder = folders.find((folder) => normalizeName(folder.name) === normalizedClient);
        if (exactFolder) {
            return `/?week=${activeWeekStr}&tab=issues&folderId=${encodeURIComponent(exactFolder.id)}${assigneeParam}${returnToParam}`;
        }

        const fuzzyFolder = folders.find((folder) => {
            const folderName = normalizeName(folder.name);
            return folderName.includes(normalizedClient) || normalizedClient.includes(folderName);
        });
        if (fuzzyFolder) {
            return `/?week=${activeWeekStr}&tab=issues&folderId=${encodeURIComponent(fuzzyFolder.id)}${assigneeParam}${returnToParam}`;
        }

        return null;
    }, [activeAssigneeFilter, activeWeekStr, buildCapacityReturnTo, folders]);

    useEffect(() => {
        const rowId = searchParams?.get("gridRowId") ?? "";
        const resourceId = searchParams?.get("gridResourceId") ?? "";
        const scrollLeft = Number(searchParams?.get("gridScrollLeft") ?? 0);
        const scrollTop = Number(searchParams?.get("gridScrollTop") ?? 0);
        const restoreKey = `${activeWeekStr}|${rowId}|${resourceId}|${scrollLeft}|${scrollTop}`;
        if (!rowId && !resourceId && !scrollLeft && !scrollTop) return;
        if (restoredViewKeyRef.current === restoreKey) return;

        const restore = () => {
            const container = gridScrollRef.current;
            if (!container) return;
            container.scrollTo({
                left: Number.isFinite(scrollLeft) ? scrollLeft : 0,
                top: Number.isFinite(scrollTop) ? scrollTop : 0,
                behavior: "auto",
            });

            if (rowId && resourceId) {
                const target = container.querySelector<HTMLElement>(`[data-grid-cell="${rowId}:${resourceId}"]`);
                if (target) {
                    target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
                }
            }

            restoredViewKeyRef.current = restoreKey;
        };

        const timer = window.setTimeout(restore, 80);
        return () => window.clearTimeout(timer);
    }, [activeWeekStr, rows, visibleResources, searchParams]);

    useEffect(() => {
        setIsWeekNavLocked(false);
        if (navUnlockTimerRef.current) {
            clearTimeout(navUnlockTimerRef.current);
            navUnlockTimerRef.current = null;
        }
    }, [activeWeekStr]);

    useEffect(() => {
        return () => {
            if (navUnlockTimerRef.current) {
                clearTimeout(navUnlockTimerRef.current);
            }
        };
    }, []);

    const navigateToWeek = useCallback((nextDate: Date | null) => {
        if (isWeekNavLocked) return;
        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (nextDate === null && activeWeekStr === currentWeekStr) return;
        if (nextDate && format(nextDate, "yyyy-MM-dd") === activeWeekStr) return;

        const href = nextDate ? weekParamFor(nextDate) : "/?tab=capacity-grid";
        setIsWeekNavLocked(true);
        window.location.href = href;
        navUnlockTimerRef.current = setTimeout(() => {
            setIsWeekNavLocked(false);
            navUnlockTimerRef.current = null;
        }, 500);
    }, [activeWeekStr, isWeekNavLocked]);

    const handlePrevWeek = () => {
        navigateToWeek(subWeeks(activeWeekDate, 1));
    };
    const handleNextWeek = () => {
        navigateToWeek(addWeeks(activeWeekDate, 1));
    };
    const handleCurrentWeek = () => {
        navigateToWeek(null);
    };

    useEffect(() => {
        const previousWeekHref = weekParamFor(subWeeks(activeWeekDate, 1));
        const nextWeekHref = weekParamFor(addWeeks(activeWeekDate, 1));
        router.prefetch(previousWeekHref);
        router.prefetch(nextWeekHref);
        router.prefetch("/?tab=capacity-grid");
    }, [router, activeWeekDate, activeWeekStr]);

    const persist = useCallback((nextRows: CapacityGridRow[], nextResources: CapacityGridResource[] = resources) => {
        const sanitizedRows = sanitizeCapacityRows(nextRows);
        const nextPayload: CapacityGridPayload = {
            resources: nextResources,
            rows: sanitizedRows,
        };
        onGridChange?.(nextPayload);
        startTransition(() => {
            updateCapacityGridConfig(activeWeekStr, {
                resources: nextPayload.resources,
                rows: nextPayload.rows,
            });
        });
    }, [activeWeekStr, onGridChange, resources, startTransition]);

    const updateRow = (rowId: string, patch: Partial<CapacityGridRow>) => {
        setRows((prev) => {
            const nextRows = sanitizeCapacityRows(
                prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
            );
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
        });
    };

    const updateAllocation = (
        rowId: string,
        resourceId: string,
        value: number
    ) => {
        const nextValue = clampNonNegative(value);
        setRows((prev) => {
            const nextRows = prev.map((row) => {
                if (row.id !== rowId) return row;
                const nextAllocations: Record<string, CapacityGridAllocation> = {
                    ...row.allocations,
                    [resourceId]: {
                        ...row.allocations[resourceId],
                        hours: nextValue,
                        source: "manual",
                    },
                };
                return {
                    ...row,
                    allocations: nextAllocations,
                };
            });
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
        });
    };

    const updateAllocationNote = (
        rowId: string,
        resourceId: string,
        note: string
    ) => {
        setRows((prev) => {
            const nextRows = prev.map((row) => {
                if (row.id !== rowId) return row;
                return {
                    ...row,
                    allocations: {
                        ...row.allocations,
                        [resourceId]: {
                            ...row.allocations[resourceId],
                            note,
                        },
                    },
                };
            });
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
        });
    };

    const handleEditAllocationNote = (rowId: string, resourceId: string, clientName: string, consultantName: string) => {
        const currentRow = rows.find((row) => row.id === rowId);
        const currentNote = String(currentRow?.allocations?.[resourceId]?.note ?? "");
        setNoteEditor({
            rowId,
            resourceId,
            clientName,
            consultantName,
            note: currentNote,
        });
    };

    const handleSaveAllocationNote = () => {
        if (!noteEditor) return;
        const nextNote = noteEditor.note.replace(/\r\n/g, "\n");
        updateAllocationNote(noteEditor.rowId, noteEditor.resourceId, nextNote);
        const nextRows = rows.map((row) => {
            if (row.id !== noteEditor.rowId) return row;
            return {
                ...row,
                allocations: {
                    ...row.allocations,
                    [noteEditor.resourceId]: {
                        ...row.allocations[noteEditor.resourceId],
                        note: nextNote,
                    },
                },
            };
        });
        persist(nextRows);
        setNoteEditor(null);
    };

    const handleAddClient = () => {
        const name = window.prompt("Client name");
        if (!name) return;
        const trimmed = name.trim();
        if (!trimmed) return;

        const existingIds = new Set(rows.map((row) => String(row.id)));
        let nextId = clientIdFromName(trimmed);
        let suffix = 2;
        while (existingIds.has(nextId)) {
            nextId = `${clientIdFromName(trimmed)}-${suffix++}`;
        }

            const allocations = resources.reduce<Record<string, { hours: number; source: "manual"; note: string }>>((acc, resource) => {
                acc[resource.id] = { hours: 0, source: "manual", note: "" };
                return acc;
            }, {});

        const nextRows = [
            ...rows,
            {
                id: nextId,
                team: 0,
                teamSa: "",
                dealType: "",
                wkMin: 0,
                wkMax: 0,
                client: trimmed,
                notes: "",
                allocations,
            },
        ];

        setRows(nextRows);
        persist(nextRows);
    };

    const handleRemoveClient = (rowId: string, clientName: string) => {
        setRemoveClientConfirm({ rowId, clientName });
    };

    const handleConfirmRemoveClient = () => {
        if (!removeClientConfirm) return;
        const nextRows = rows.filter((row) => row.id !== removeClientConfirm.rowId);
        setRows(nextRows);
        persist(nextRows);
        setRemoveClientConfirm(null);
    };

    const rowStats = useMemo(() => {
        return rows.map((row) => {
            const total = visibleResources.reduce((sum, resource) => sum + Number(row.allocations[resource.id]?.hours ?? 0), 0);
            return {
                id: row.id,
                total,
                gapToMin: total - Number(row.wkMin || 0),
                gapToMax: Number(row.wkMax || 0) - total,
            };
        });
    }, [rows, visibleResources]);

    const totals = useMemo(() => {
        const hoursByResource: Record<string, number> = {};
        visibleResources.forEach((resource) => {
            hoursByResource[resource.id] = rows.reduce((sum, row) => sum + Number(row.allocations[resource.id]?.hours ?? 0), 0);
        });

        const wkMinTotal = rows.reduce((sum, row) => sum + Number(row.wkMin || 0), 0);
        const wkMaxTotal = rows.reduce((sum, row) => sum + Number(row.wkMax || 0), 0);
        const totalHours = Object.values(hoursByResource).reduce((a, b) => a + b, 0);

        return {
            hoursByResource,
            wkMinTotal,
            wkMaxTotal,
            totalHours,
            gapToMin: totalHours - wkMinTotal,
            gapToMax: wkMaxTotal - totalHours,
        };
    }, [rows, visibleResources]);

    const billableCapacityByResource = useMemo(() => {
        const billableByName = new Map<string, number>();
        consultants.forEach((consultant) => {
            const cfg = consultantConfigs[consultant.id] || { billableCapacity: 40 };
            const billable = Number(cfg.billableCapacity ?? 40);
            const full = normalizeName(consultant.name);
            const first = normalizeName(String(consultant.name || "").split(/\s+/)[0] || "");
            if (full) billableByName.set(full, billable);
            if (first && !billableByName.has(first)) billableByName.set(first, billable);
        });

        const map: Record<string, number> = {};
        visibleResources.forEach((resource) => {
            const consultantId = Number(resource.consultantId ?? 0);
            if (consultantId > 0) {
                const cfg = consultantConfigs[consultantId] || { billableCapacity: 40 };
                map[resource.id] = Number(cfg.billableCapacity ?? 40);
                return;
            }
            const fullKey = normalizeName(resource.name);
            const firstKey = normalizeName(String(resource.name || "").split(/\s+/)[0] || "");
            const fallback = billableByName.get(fullKey) ?? billableByName.get(firstKey) ?? 0;
            map[resource.id] = Number(fallback);
        });
        return map;
    }, [visibleResources, consultants, consultantConfigs]);

    const getConsultantHeaderClass = (resourceId: string) => {
        const cap = Number(billableCapacityByResource[resourceId] ?? 0);
        const allocated = Number(totals.hoursByResource[resourceId] ?? 0);
        if (cap <= 0) return "text-slate-200";
        if (Math.abs(allocated - cap) < 0.01) return "text-emerald-400";
        if (allocated > cap) return "text-red-400";
        return "text-white";
    };

    const getClientStatusClass = (total: number, wkMin: number, wkMax: number) => {
        if (total < wkMin) return "text-white";
        if (wkMax <= 0) return "text-emerald-400";
        if (total > wkMax) return "text-red-400";
        return "text-emerald-400";
    };

    const getScopeLabels = useCallback((scopeType: string, scopeId: string) => {
        if (scopeType === "list") {
            const match = folders.flatMap((folder) => folder.lists).find((list) => String(list.id) === String(scopeId));
            return [match?.name ?? scopeId].filter(Boolean);
        }
        if (scopeType === "folder") {
            const match = folders.find((folder) => String(folder.id) === String(scopeId));
            return [match?.name ?? scopeId].filter(Boolean);
        }
        return [scopeId].filter(Boolean);
    }, [folders]);

    const getBillableActualsForCell = useCallback((row: CapacityGridRow, resource: CapacityGridResource) => {
        const rowClientKey = normalizeName(String(row.client || ""));
        if (!rowClientKey) return 0;

        const resourceFullKey = normalizeName(String(resource.name || ""));
        const resourceFirstKey = normalizeName(String(resource.name || "").split(/\s+/)[0] || "");
        if (!resourceFullKey && !resourceFirstKey) return 0;

        return billableRollups.reduce((sum, rollup) => {
            const assigneeFullKey = normalizeName(String(rollup.assignee || ""));
            const assigneeFirstKey = normalizeName(String(rollup.assignee || "").split(/\s+/)[0] || "");
            const consultantMatch = (
                (resourceFullKey && assigneeFullKey === resourceFullKey)
                || (resourceFirstKey && assigneeFullKey === resourceFirstKey)
                || (resourceFullKey && assigneeFirstKey === resourceFullKey)
                || (resourceFirstKey && assigneeFirstKey === resourceFirstKey)
            );
            if (!consultantMatch) return sum;

            const scopeMatches = getScopeLabels(String(rollup.scopeType || ""), String(rollup.scopeId || "")).some((label) => {
                const labelKey = normalizeName(label);
                return labelKey.length > 0 && (
                    labelKey === rowClientKey
                    || labelKey.includes(rowClientKey)
                    || rowClientKey.includes(labelKey)
                );
            });

            if (!scopeMatches) return sum;
            return sum + Number(rollup.hours ?? 0);
        }, 0);
    }, [billableRollups, getScopeLabels]);

    const clickupMetricsByPair = useMemo(() => {
        const exactMap = new Map<string, ClickUpCellMetrics>();
        const byConsultantListName = new Map<string, Map<string, ClickUpCellMetrics>>();

        const add = (consultantKey: string, clientKey: string, metrics: ClickUpCellMetrics) => {
            if (!consultantKey || !clientKey || (metrics.planned <= 0 && metrics.actuals <= 0)) return;
            const key = `${consultantKey}|${clientKey}`;
            const current = exactMap.get(key) ?? { planned: 0, actuals: 0 };
            exactMap.set(key, {
                planned: current.planned + metrics.planned,
                actuals: current.actuals + metrics.actuals,
            });
        };

        const addListName = (consultantKey: string, listNameKey: string, metrics: ClickUpCellMetrics) => {
            if (!consultantKey || !listNameKey || (metrics.planned <= 0 && metrics.actuals <= 0)) return;
            const byList = byConsultantListName.get(consultantKey) || new Map<string, ClickUpCellMetrics>();
            const current = byList.get(listNameKey) ?? { planned: 0, actuals: 0 };
            byList.set(listNameKey, {
                planned: current.planned + metrics.planned,
                actuals: current.actuals + metrics.actuals,
            });
            byConsultantListName.set(consultantKey, byList);
        };

        const weekStartMs = new Date(activeWeekStr + "T00:00:00").getTime();
        const weekEndMs = addDays(new Date(weekStartMs), 6).getTime();

        tasks.forEach((task) => {
            const estimateMs = Number(task?.time_estimate ?? 0);
            const plannedHours = estimateMs / (1000 * 60 * 60);
            if (plannedHours <= 0) return;

            const dateMs = Number(task?.due_date ?? task?.start_date ?? task?.date_created ?? 0);
            if (!Number.isFinite(dateMs) || dateMs < weekStartMs || dateMs > weekEndMs) return;

            const listIdKey = normalizeName(String(task?.list?.id ?? ""));
            const listNameKey = normalizeName(String(task?.list?.name ?? ""));
            const clientKeys: string[] = [];
            if (listIdKey) clientKeys.push(`id:${listIdKey}`);
            if (listNameKey) clientKeys.push(`name:${listNameKey}`);
            if (clientKeys.length === 0) return;

            const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
            if (assignees.length === 0) return;

            const splitMetrics = {
                planned: plannedHours / assignees.length,
                actuals: 0,
            };
            assignees.forEach((assignee) => {
                const consultantId = Number((assignee as any)?.id ?? 0);
                const consultantNameRaw = String((assignee as any)?.username ?? "");
                const consultantNameKey = normalizeName(consultantNameRaw);
                const consultantFirstKey = normalizeName((consultantNameRaw.split(/\s+/)[0] || ""));
                const consultantKeys: string[] = [];
                if (consultantId > 0) consultantKeys.push(`id:${consultantId}`);
                if (consultantNameKey) consultantKeys.push(`name:${consultantNameKey}`);
                if (consultantFirstKey) consultantKeys.push(`first:${consultantFirstKey}`);

                consultantKeys.forEach((consultantKey) => {
                    if (listNameKey) {
                        addListName(consultantKey, listNameKey, splitMetrics);
                    }
                    clientKeys.forEach((clientKey) => {
                        add(consultantKey, clientKey, splitMetrics);
                    });
                });
            });
        });

        return {
            exactMap,
            byConsultantListName,
        };
    }, [tasks, activeWeekStr]);

    const getClickupMetricsForCell = useCallback((row: CapacityGridRow, resource: CapacityGridResource): ClickUpCellMetrics => {
        const consultantId = Number(resource.consultantId ?? 0);
        const consultantName = String(resource.name || "");
        const consultantNameKey = normalizeName(consultantName);
        const consultantFirstKey = normalizeName((consultantName.split(/\s+/)[0] || ""));
        const consultantKeys: string[] = [];
        if (consultantId > 0) consultantKeys.push(`id:${consultantId}`);
        if (consultantNameKey) consultantKeys.push(`name:${consultantNameKey}`);
        if (consultantFirstKey) consultantKeys.push(`first:${consultantFirstKey}`);

        const rowIdKey = normalizeName(String(row.id || ""));
        const rowNameKey = normalizeName(String(row.client || ""));
        const clientKeys: string[] = [];
        if (rowIdKey) clientKeys.push(`id:${rowIdKey}`);
        if (rowNameKey) clientKeys.push(`name:${rowNameKey}`);

        for (const consultantKey of consultantKeys) {
            for (const clientKey of clientKeys) {
                const hit = clickupMetricsByPair.exactMap.get(`${consultantKey}|${clientKey}`);
                if (hit) return hit;
            }
        }

        // Fallback match: if the row uses a grouped/shortened client label
        // (e.g. "SodaStream"), sum matching ClickUp list-name buckets.
        const primaryConsultantKey = consultantKeys[0];
        const rowClientNorm = rowNameKey;
        if (primaryConsultantKey && rowClientNorm) {
            const byListName = clickupMetricsByPair.byConsultantListName.get(primaryConsultantKey);
            if (byListName && rowClientNorm.length >= 4) {
                let planned = 0;
                let actuals = 0;
                let found = false;
                byListName.forEach((listMetrics, listNameNorm) => {
                    if (
                        listNameNorm === rowClientNorm
                        || listNameNorm.includes(rowClientNorm)
                        || rowClientNorm.includes(listNameNorm)
                    ) {
                        planned += Number(listMetrics?.planned || 0);
                        actuals += Number(listMetrics?.actuals || 0);
                        found = true;
                    }
                });
                if (found) return { planned, actuals };
            }
        }

        return { planned: 0, actuals: 0 };
    }, [clickupMetricsByPair]);

    const actualsByResource = useMemo(() => {
        const result: Record<string, number> = {};
        visibleResources.forEach((resource) => {
            result[resource.id] = rows.reduce((sum, row) => {
                return sum + Number(getBillableActualsForCell(row, resource) ?? 0);
            }, 0);
        });
        return result;
    }, [rows, visibleResources, getBillableActualsForCell]);

    const totalActuals = useMemo(() => {
        return Object.values(actualsByResource).reduce((sum, value) => sum + Number(value ?? 0), 0);
    }, [actualsByResource]);

    const clickupSeedPlan = useMemo(() => {
        const ops: Array<{ rowId: string; resourceId: string; hours: number }> = [];

        rows.forEach((row) => {
            visibleResources.forEach((resource) => {
                const clickup = getClickupMetricsForCell(row, resource);
                const currentHours = Number(row.allocations[resource.id]?.hours ?? 0);
                const seedHours = Number(Number(clickup.planned || 0).toFixed(1));
                if (Math.abs(seedHours - currentHours) < 0.05) return;

                ops.push({
                    rowId: row.id,
                    resourceId: resource.id,
                    hours: seedHours,
                });
            });
        });

        const key = `${activeWeekStr}|${ops
            .map((op) => `${op.rowId}:${op.resourceId}:${op.hours}`)
            .join("|")}`;
        return { ops, key };
    }, [activeWeekStr, rows, visibleResources, getClickupMetricsForCell]);

    useEffect(() => {
        if (rows.length === 0 || visibleResources.length === 0) return;
        if (clickupSeedPlan.ops.length === 0) return;

        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (activeWeekStr < currentWeekStr) return;
        if (autoFillRunKeyRef.current === clickupSeedPlan.key) return;

        const opMap = new Map<string, { hours: number }>();
        clickupSeedPlan.ops.forEach((op) => {
            opMap.set(`${op.rowId}|${op.resourceId}`, { hours: op.hours });
        });

        let changed = false;
        const nextRows = rows.map((row) => {
            let rowChanged = false;
            const nextAllocations = { ...row.allocations };

            visibleResources.forEach((resource) => {
                const op = opMap.get(`${row.id}|${resource.id}`);
                if (!op) return;

                const currentHours = Number(row.allocations[resource.id]?.hours ?? 0);
                const nextHours = Number(op.hours ?? currentHours);

                if (Math.abs(nextHours - currentHours) < 0.05) {
                    return;
                }

                nextAllocations[resource.id] = {
                    ...row.allocations[resource.id],
                    hours: nextHours,
                    source: "clickup",
                };
                rowChanged = true;
                changed = true;
            });

            return rowChanged ? { ...row, allocations: nextAllocations } : row;
        });

        autoFillRunKeyRef.current = clickupSeedPlan.key;
        if (!changed) return;

        setRows(nextRows);
        persist(nextRows);
    }, [activeWeekStr, rows, visibleResources, clickupSeedPlan, persist]);

    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    return (
        <>
        <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(21,26,43,0.96)_0%,rgba(13,18,29,0.96)_100%)] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.35)]" />
                        Capacity Grid
                    </h2>
                    <div className="flex items-center overflow-hidden rounded-xl border border-border/60 bg-[#0f1320]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <button
                            onClick={handlePrevWeek}
                            disabled={isWeekNavLocked}
                            className="flex h-10 w-10 items-center justify-center border-r border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="min-w-[220px] px-4 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Week W{weekNumber}</div>
                            <div className="mt-1 text-sm font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={handleNextWeek}
                            disabled={isWeekNavLocked}
                            className="flex h-10 w-10 items-center justify-center border-l border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <button
                        onClick={handleCurrentWeek}
                        disabled={isWeekNavLocked}
                        className={cn(
                            "h-10 rounded-xl border px-4 text-xs font-semibold transition-colors",
                            isCurrentWeek
                                ? "border-border/70 bg-white/[0.05] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                                : "border-border/60 bg-[#0f1320]/70 text-text-muted hover:bg-surface-hover hover:text-white"
                        )}
                    >
                        Current Week
                    </button>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-xs text-text-muted">{weekLabel}</span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleAddClient}
                        className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-[#0f1320]/80 px-4 py-2 text-xs font-semibold text-text-main hover:bg-surface-hover"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add Client
                    </button>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-[11px] text-text-muted">{isPending ? "Saving..." : "Persistent planning scratchboard"}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Planned</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totals.totalHours.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Actuals</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totalActuals.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">WK Min Total</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totals.wkMinTotal.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">WK Max Total</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totals.wkMaxTotal.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Gap vs WK Min</div>
                    <div className={cn("mt-2 text-3xl font-bold", totals.gapToMin >= 0 ? "text-white" : "text-slate-400")}>
                        {totals.gapToMin.toFixed(1)}
                    </div>
                </div>
            </div>

            <div ref={gridScrollRef} className="relative max-h-[calc(100vh-18rem)] overflow-auto rounded-[28px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                <table className="min-w-[1800px] w-full border-separate border-spacing-0 text-[12px]">
                    <thead>
                        <tr className="border-b-2 border-border/50 text-text-muted text-[11px] font-bold tracking-wider bg-[#111626]/90 text-[#94a3b8] cap-none">
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Team</th>
                            <th className={cn("px-3 py-3 text-left border-r border-border/40", headerTopRowStickyClass)}>SA</th>
                            <th className={cn("px-3 py-3 text-left border-r border-border/40", headerTopRowStickyClass)}>Deal Type</th>
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Wk Min</th>
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Wk Max</th>
                            <th className={cn("px-2 py-2 text-left border-r border-border/40", headerTopRowStickyClass, clientHeaderStickyClass)}>
                                <div className="rounded-xl border border-border/55 bg-[#1a2035] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Client</div>
                                </div>
                            </th>
                            {visibleResources.map((resource) => {
                                const used = Number(totals.hoursByResource[resource.id] ?? 0);
                                const maxBillable = Number(billableCapacityByResource[resource.id] ?? 0);
                                return (
                                    <th key={resource.id} className={cn("w-[132px] min-w-[132px] max-w-[132px] px-2 py-2 text-center border-r border-border/40", headerTopRowStickyClass)}>
                                        <div className="flex h-[82px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-border/55 bg-[#1a2035] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] leading-tight">
                                            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
                                                Consultant
                                            </span>
                                            <span className={cn("font-semibold transition-colors", getConsultantHeaderClass(resource.id))}>
                                                {resource.name}
                                            </span>
                                            <span className={cn("text-[11px] font-semibold", getConsultantHeaderClass(resource.id))}>
                                                {used.toFixed(1)} / {maxBillable.toFixed(1)}
                                            </span>
                                        </div>
                                    </th>
                                );
                            })}
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Planned / Actual</th>
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Gap to Min</th>
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Gap to Max</th>
                            <th className={cn("px-3 py-3 text-left border-r border-border/40", headerTopRowStickyClass)}>Notes</th>
                            <th className={cn("px-3 py-3 text-center", headerTopRowStickyClass)}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => {
                            const stats = rowStats.find((s) => s.id === row.id);
                            const rowTotal = Number(stats?.total ?? 0);
                            const rowActualTotal = visibleResources.reduce((sum, resource) => sum + Number(getBillableActualsForCell(row, resource) ?? 0), 0);
                            const clientStatusClass = getClientStatusClass(rowTotal, Number(row.wkMin || 0), Number(row.wkMax || 0));
                            const laneClass = rowIndex % 2 === 0 ? "bg-[#0d121d]/72 hover:bg-[#12192a]/82" : "bg-[#101622]/78 hover:bg-[#151d30]/86";
                            const laneBorderClass = rowIndex % 2 === 0 ? "border-border/35" : "border-border/20";
                            const clientLaneClass = rowIndex % 2 === 0 ? "bg-[#121b35]" : "bg-[#0f1830]";
                            return (
                                <tr key={row.id} className={cn("border-t transition-colors", laneClass, laneBorderClass)}>
                                    <td className={cn("px-2 py-2 border-r text-right", laneBorderClass)}>
                                        <input
                                            type="number"
                                            value={row.team}
                                            min="0"
                                            onChange={(e) => updateRow(row.id, { team: clampNonNegative(toNumber(e.target.value)) })}
                                            onBlur={() => persist(rows)}
                                            className="w-12 rounded-lg border border-transparent bg-white/[0.02] px-1 py-1 text-right text-text-main focus:border-border/70 focus:bg-white/[0.04]"
                                        />
                                    </td>
                                    <td className={cn("px-2 py-2 border-r", laneBorderClass)}>
                                        <input
                                            value={row.teamSa}
                                            onChange={(e) => updateRow(row.id, { teamSa: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className="w-28 rounded-lg border border-transparent bg-white/[0.02] px-2 py-1 text-text-main focus:border-border/70 focus:bg-white/[0.04]"
                                        />
                                    </td>
                                    <td className={cn("px-2 py-2 border-r", laneBorderClass)}>
                                        <input
                                            value={row.dealType}
                                            onChange={(e) => updateRow(row.id, { dealType: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className="w-20 rounded-lg border border-transparent bg-white/[0.02] px-2 py-1 text-text-main focus:border-border/70 focus:bg-white/[0.04]"
                                        />
                                    </td>
                                    <td className={cn("px-2 py-2 text-right border-r", laneBorderClass)}>
                                        <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            value={row.wkMin}
                                            onChange={(e) => updateRow(row.id, { wkMin: clampNonNegative(toNumber(e.target.value)) })}
                                            onBlur={() => persist(rows)}
                                            className="w-16 rounded-lg border border-transparent bg-white/[0.02] px-1 py-1 text-right text-text-main focus:border-border/70 focus:bg-white/[0.04]"
                                        />
                                    </td>
                                    <td className={cn("px-2 py-2 text-right border-r", laneBorderClass)}>
                                        <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            value={row.wkMax}
                                            onChange={(e) => updateRow(row.id, { wkMax: clampNonNegative(toNumber(e.target.value)) })}
                                            onBlur={() => persist(rows)}
                                            className="w-16 rounded-lg border border-transparent bg-white/[0.02] px-1 py-1 text-right text-text-main focus:border-border/70 focus:bg-white/[0.04]"
                                        />
                                    </td>
                                    <td className={cn("px-2 py-2 border-r", laneBorderClass, clientBodyStickyClass, clientLaneClass)}>
                                        <input
                                            value={row.client}
                                            onChange={(e) => updateRow(row.id, { client: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className={cn("w-44 rounded-xl border border-white/[0.04] bg-white/[0.03] px-3 py-2 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus:border-border/70 focus:bg-white/[0.05]", clientStatusClass)}
                                        />
                                    </td>
                                    {visibleResources.map((resource) => (
                                        <Fragment key={`${row.id}-${resource.id}`}>
                                            {(() => {
                                                const clickup = getClickupMetricsForCell(row, resource);
                                                const plannedHours = Number(row.allocations[resource.id]?.hours ?? 0);
                                                const clickupHours = Number(clickup.planned || 0);
                                                const actualHours = Number(getBillableActualsForCell(row, resource) || 0);
                                                const allocationNote = String(row.allocations[resource.id]?.note ?? "");
                                                const clientBoardHref = resolveClientBoardHref(row, resource, resource.name);
                                                const plannedVsActualMatch = Math.abs(plannedHours - actualHours) < 0.05;
                                                const heatMapClass = plannedVsActualMatch
                                                    ? "bg-slate-700/35 border-slate-500/45 text-slate-100"
                                                    : "bg-slate-600/35 border-slate-400/55 text-white";
                                                const noteHighlightClass = allocationNote
                                                    ? "ring-2 ring-slate-300/45 border-slate-300/60 shadow-[0_0_0_1px_rgba(203,213,225,0.16)]"
                                                    : "";
                                                const noteHint = allocationNote ? ` | Note: ${allocationNote}` : "";
                                                const handleStepAllocation = (delta: number) => {
                                                    const nextValue = Math.max(0, roundToHalfStep(plannedHours + delta));
                                                    updateAllocation(row.id, resource.id, nextValue);
                                                    persist(
                                                        rows.map((candidateRow) => {
                                                            if (candidateRow.id !== row.id) return candidateRow;
                                                            return {
                                                                ...candidateRow,
                                                                allocations: {
                                                                    ...candidateRow.allocations,
                                                                    [resource.id]: {
                                                                        ...candidateRow.allocations[resource.id],
                                                                        hours: nextValue,
                                                                        source: "manual",
                                                                    },
                                                                },
                                                            };
                                                        })
                                                    );
                                                };
                                                return (
                                                    <td
                                                        data-grid-cell={`${row.id}:${resource.id}`}
                                                        className={cn("px-1.5 py-2 text-center border-r", laneBorderClass)}
                                                    >
                                                        <div className="mx-auto flex w-[88px] flex-col items-center gap-1">
                                                            <div className="w-full">
                                                                <div className="mb-0.5 flex items-center justify-center gap-1 text-[9px] uppercase tracking-wide text-text-muted">
                                                                    <span>Planned</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(event) => {
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                            if (!clientBoardHref) return;
                                                                            window.location.href = clientBoardHref;
                                                                        }}
                                                                        disabled={!clientBoardHref}
                                                                        title={clientBoardHref ? `Open ${row.client} task board` : `No board match found for ${row.client}`}
                                                                        className="inline-flex items-center justify-center rounded border border-border/50 p-[2px] text-text-muted hover:text-white hover:border-border/80 disabled:cursor-not-allowed disabled:opacity-35"
                                                                        aria-label={`Open ${row.client} task board`}
                                                                    >
                                                                        <ArrowUpRight className="h-2.5 w-2.5" />
                                                                    </button>
                                                                </div>
                                                                <div className="flex w-full items-stretch gap-1">
                                                                    <input
                                                                        type="number"
                                                                        step="0.5"
                                                                        min="0"
                                                                        value={Number(row.allocations[resource.id]?.hours ?? 0).toFixed(1)}
                                                                        onChange={(e) => updateAllocation(row.id, resource.id, clampNonNegative(toNumber(e.target.value)))}
                                                                        onBlur={() => persist(rows)}
                                                                        onDoubleClick={() => handleEditAllocationNote(row.id, resource.id, row.client, resource.name)}
                                                                        title={`ClickUp Planned: ${clickupHours.toFixed(1)}h | Logged Actuals: ${actualHours.toFixed(1)}h${noteHint}`}
                                                                        className={cn(
                                                                            "block h-8 min-w-0 flex-1 rounded border px-2 py-1 text-right text-[12px] font-medium tabular-nums [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-border cursor-text",
                                                                            heatMapClass,
                                                                            noteHighlightClass
                                                                        )}
                                                                    />
                                                                    <div className="flex h-8 w-5 flex-col overflow-hidden rounded border border-border/45 bg-[#151a2b]">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleStepAllocation(0.5)}
                                                                            className="flex flex-1 items-center justify-center border-b border-border/45 text-text-muted transition hover:bg-white/[0.06] hover:text-white"
                                                                            aria-label={`Increase planned hours for ${row.client} and ${resource.name}`}
                                                                        >
                                                                            <ChevronUp className="h-2.5 w-2.5" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleStepAllocation(-0.5)}
                                                                            className="flex flex-1 items-center justify-center text-text-muted transition hover:bg-white/[0.06] hover:text-white"
                                                                            aria-label={`Decrease planned hours for ${row.client} and ${resource.name}`}
                                                                        >
                                                                            <ChevronDown className="h-2.5 w-2.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="w-full">
                                                                <div className="mb-0.5 text-center text-[9px] uppercase tracking-wide text-text-muted">Actuals</div>
                                                                <div
                                                                    onDoubleClick={() => handleEditAllocationNote(row.id, resource.id, row.client, resource.name)}
                                                                    title={allocationNote || "Double-click to add note"}
                                                                    className={cn("flex h-8 w-full items-center justify-end rounded border px-2 py-1 text-right text-[12px] font-medium tabular-nums cursor-pointer", heatMapClass, noteHighlightClass)}
                                                                >
                                                                    {actualHours.toFixed(1)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                            })()}
                                        </Fragment>
                                    ))}
                                    <td className={cn("px-3 py-2 text-right border-r font-bold text-white", laneBorderClass)}>
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                                {Number(stats?.total ?? 0).toFixed(1)}
                                            </div>
                                            <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/45 bg-white/[0.04] px-2 py-1 text-slate-100">
                                                {Number(rowActualTotal ?? 0).toFixed(1)}
                                            </div>
                                        </div>
                                    </td>
                                    <td className={cn("px-3 py-2 text-right border-r font-medium", laneBorderClass, (stats?.gapToMin ?? 0) >= 0 ? "text-white" : "text-slate-400")}>
                                        {stats?.gapToMin.toFixed(1)}
                                    </td>
                                    <td className={cn("px-3 py-2 text-right border-r font-medium", laneBorderClass, (stats?.gapToMax ?? 0) >= 0 ? "text-text-main" : "text-slate-300")}>
                                        {stats?.gapToMax.toFixed(1)}
                                    </td>
                                    <td className={cn("px-2 py-2 border-r", laneBorderClass)}>
                                        <input
                                            value={row.notes}
                                            onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className="w-72 rounded-lg border border-transparent bg-white/[0.02] px-2 py-1 text-text-main focus:border-border/70 focus:bg-white/[0.04]"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveClient(row.id, row.client)}
                                            className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 text-text-muted hover:text-white hover:border-border/80 hover:bg-white/[0.05]"
                                            aria-label={`Remove ${row.client}`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="border-t border-border/40 bg-white/[0.03]">
                            <td colSpan={3} className="px-3 py-2 font-semibold text-text-main border-r border-border/30">
                                Totals
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-text-main">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.wkMinTotal.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-text-main">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.wkMaxTotal.toFixed(1)}
                                </div>
                            </td>
                            <td className={cn("px-3 py-2 border-r border-border/30 text-text-muted text-xs bg-white/[0.03]", clientFooterStickyClass)}>
                                Clients
                            </td>
                            {visibleResources.map((resource) => (
                                <td key={`tot-${resource.id}`} className="px-2 py-2 border-r border-border/20 text-right text-[11px] font-semibold text-text-main">
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="inline-flex min-w-[4.5rem] justify-end rounded border border-border/35 bg-surface/30 px-1.5 py-1">
                                            {totals.hoursByResource[resource.id].toFixed(1)}
                                        </div>
                                        <div className="inline-flex min-w-[4.5rem] justify-end rounded border border-border/45 bg-white/[0.04] px-1.5 py-1 text-slate-100">
                                            {Number(actualsByResource[resource.id] ?? 0).toFixed(1)}
                                        </div>
                                    </div>
                                </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30">
                                <div className="flex flex-col items-end gap-1">
                                    <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                        {totals.totalHours.toFixed(1)}
                                    </div>
                                    <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/45 bg-white/[0.04] px-2 py-1 text-slate-100">
                                        {totalActuals.toFixed(1)}
                                    </div>
                                </div>
                            </td>
                            <td className={cn("px-3 py-2 text-right font-semibold border-r border-border/30", totals.gapToMin >= 0 ? "text-white" : "text-slate-400")}>
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.gapToMin.toFixed(1)}
                                </div>
                            </td>
                            <td className={cn("px-3 py-2 text-right font-semibold border-r border-border/30", totals.gapToMax >= 0 ? "text-text-main" : "text-slate-300")}>
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.gapToMax.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-text-muted border-r border-border/30">
                                <div className="flex items-center gap-1">
                                    <Grid2x2 className="w-3.5 h-3.5" />
                                    Calculated fields are formula-driven
                                </div>
                            </td>
                            <td className="px-3 py-2"></td>
                        </tr>
                        <tr className="border-t border-border/30 bg-surface/20">
                            <td colSpan={6} className="px-3 py-2 font-semibold text-text-main border-r border-border/30">
                                Billable Capacity
                            </td>
                            {visibleResources.map((resource) => (
                                <td key={`cap-${resource.id}`} className="px-2 py-2 border-r border-border/20 text-center text-[11px] font-semibold text-slate-300">
                                    <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                        {Number(billableCapacityByResource[resource.id] ?? 0).toFixed(1)}
                                    </div>
                                </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-slate-300">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {Object.values(billableCapacityByResource).reduce((sum, hrs) => sum + Number(hrs || 0), 0).toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-slate-300">-</td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-slate-300">-</td>
                            <td className="px-3 py-2 text-xs text-text-muted border-r border-border/30">
                                Pulled from Consultant Utilization billable capacity
                            </td>
                            <td className="px-3 py-2"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>

        </section>
        {noteEditor && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                    <div className="flex items-center justify-between border-b border-border/50 bg-[#151a2b] px-5 py-4">
                        <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Capacity Note</div>
                            <div className="mt-2 text-lg font-semibold text-white">Planning Context</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                                <span className="inline-flex items-center rounded-full border border-border/50 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-200">
                                    {noteEditor.clientName}
                                </span>
                                <span>·</span>
                                <span>{noteEditor.consultantName}</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setNoteEditor(null)}
                            className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            aria-label="Close note editor"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="bg-[linear-gradient(180deg,#0f1424_0%,#0d121d_100%)] p-5">
                        <div className="rounded-2xl border border-border/50 bg-[#151a2b] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Comment</div>
                                    <div className="mt-1 text-sm font-semibold text-white">Notes for this capacity cell</div>
                                </div>
                                <span className="rounded-full border border-border/50 bg-surface/40 px-2.5 py-1 text-[11px] text-text-muted">
                                    {format(new Date(), "MMM d, yyyy")}
                                </span>
                            </div>
                            <textarea
                                value={noteEditor.note}
                                onChange={(event) => setNoteEditor((prev) => prev ? { ...prev, note: event.target.value } : prev)}
                                rows={12}
                                placeholder="Add context, follow-ups, assumptions, or handoff notes for this cell..."
                                className="min-h-[320px] w-full resize-none rounded-xl border border-border/60 bg-[#0f1320] px-4 py-4 text-sm leading-7 text-white outline-none placeholder:text-text-muted focus:border-border/80 focus:bg-[#111729]"
                                autoFocus
                            />
                            <div className="mt-3 text-[11px] text-text-muted">
                                Use this space for planning assumptions, blockers, dependencies, or handoff context.
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/50 bg-surface/50 px-5 py-4">
                        <div className="text-xs text-text-muted">
                            Double-click any planned or actuals cell to open this note.
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setNoteEditor(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveAllocationNote}
                                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-white/[0.05] px-3 py-2 text-sm text-white hover:bg-white/[0.08]"
                            >
                                <Save className="w-4 h-4" />
                                Save Note
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        {removeClientConfirm && (
            <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                    <div className="border-b border-border/50 bg-surface/80 px-5 py-4">
                        <div className="text-sm font-semibold text-text-main">Remove Client</div>
                        <div className="mt-1 text-xs text-text-muted">
                            This will remove <span className="font-medium text-white">{removeClientConfirm.clientName}</span> from this week&apos;s capacity grid.
                        </div>
                    </div>
                    <div className="px-5 py-4 text-sm text-text-muted">
                        Existing allocations in this row will be removed from the current weekly grid.
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => setRemoveClientConfirm(null)}
                            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirmRemoveClient}
                            className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20"
                        >
                            <Trash2 className="w-4 h-4" />
                            Remove Client
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
