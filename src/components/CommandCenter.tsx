"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, subWeeks, addWeeks, addDays, startOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ClickUpTask, TimeEntry } from "@/lib/clickup";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandCenterProps {
    tasks: ClickUpTask[];
    timeEntries: TimeEntry[];
    activeWeekStr: string;
    dbConfig: any;
    onNavigateWeek?: (nextWeek: string) => void;
    isWeekLoading?: boolean;
}

interface ClientPaceTrackerRow {
    id: string;
    team: number;
    client: string;
    sa: string;
    dealType: string;
    wkMax: number;
    plannedHours: number;
    billedHours: number;
    monthlyMax: number;
    isPlannedOverMonthlyMax: boolean;
    isOverMonthlyMax: boolean;
    statusLabel: string;
}

interface CapacityHeaderMetrics {
    totalCapacity: number;
    planned: number;
    actuals: number;
    wkMinTotal: number;
    wkMaxTotal: number;
    gapToMin: number;
}

const DEFAULT_LEAD_TARGETS: Record<string, number> = {
    "James W.": 117,
    "Monica": 110,
    "Omair": 64,
    "Greg": 37.5,
    "Joe": 30,
    "Mike": 10,
    "Nikko": 3,
    "James/Omair": 2,
};

function normalizeName(value: string): string {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getAllocationHours(cell: unknown) {
    const legacyCell = cell as { hours?: number; wt?: number; wPlus?: number } | undefined;
    return Number(legacyCell?.hours ?? Number(legacyCell?.wt ?? 0) + Number(legacyCell?.wPlus ?? 0));
}

export function CommandCenter({ tasks, timeEntries, activeWeekStr, dbConfig, onNavigateWeek, isWeekLoading = false }: CommandCenterProps) {
    const router = useRouter();

    // ----- Date & Week Logic -----
    // Append time to ensure we parse the exact UTC day without local timezone shift
    const activeWeekDate = useMemo(() => new Date(activeWeekStr + 'T00:00:00'), [activeWeekStr]);

    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const currentWeekStartStr = format(currentWeekStart, 'yyyy-MM-dd');

    const isPastWeek = activeWeekStr < currentWeekStartStr;
    const isCurrentWeek = activeWeekStr === currentWeekStartStr;
    const isNavigationBlocked = !onNavigateWeek && isWeekLoading;

    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=command-center`;

    const handlePrevWeek = () => {
        const nextWeek = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
        if (onNavigateWeek) {
            onNavigateWeek(nextWeek);
            return;
        }
        router.push(weekParamFor(subWeeks(activeWeekDate, 1)));
    };
    const handleNextWeek = () => {
        const nextWeek = format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd");
        if (onNavigateWeek) {
            onNavigateWeek(nextWeek);
            return;
        }
        router.push(weekParamFor(addWeeks(activeWeekDate, 1)));
    };
    const handleCurrentWeek = () => {
        const currentWeek = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (onNavigateWeek) {
            onNavigateWeek(currentWeek);
            return;
        }
        router.push(`/?tab=command-center`);
    };

    // ----- Top Level Metrics State (Scoped by Week) -----
    // Initial Hydration from DB payload
    const [baseTarget, setBaseTarget] = useState(dbConfig?.weekConfig?.baseTarget ?? 350);
    const [stretchTarget, setStretchTarget] = useState(dbConfig?.weekConfig?.stretchTarget ?? 400);

    // ----- Data Aggregation -----
    const tasksMap = useMemo(() => {
        const map = new Map<string, ClickUpTask>();
        tasks.forEach(t => map.set(t.id, t));
        return map;
    }, [tasks]);

    const activeWeekStartMs = startOfWeek(activeWeekDate, { weekStartsOn: 1 }).getTime();
    const activeWeekEndMs = addDays(new Date(activeWeekStartMs), 6).getTime();
    const activeMonthStartDate = startOfMonth(activeWeekDate);
    const activeMonthEndDate = endOfMonth(activeWeekDate);
    const activeMonthStartMs = activeMonthStartDate.getTime();
    const activeMonthEndMs = activeMonthEndDate.getTime();
    const activeMonthLabel = format(activeMonthStartDate, "MMMM yyyy");
    const activeMonthProgress = useMemo(() => {
        const daysInMonth = Math.max(1, activeMonthEndDate.getDate());
        const now = new Date();
        const referenceDate = isCurrentWeek
            ? now
            : activeWeekDate > now
                ? activeMonthStartDate
                : activeMonthEndDate;
        const dayOfMonth = Math.min(daysInMonth, Math.max(1, referenceDate.getDate()));
        return dayOfMonth / daysInMonth;
    }, [activeMonthEndDate, activeMonthStartDate, activeWeekDate, isCurrentWeek]);

    const activeWeekTimeEntries = useMemo(() => {
        return timeEntries.filter((entry) => {
            const entryStartMs = Number(entry?.start || 0);
            return entryStartMs >= activeWeekStartMs && entryStartMs <= activeWeekEndMs;
        });
    }, [timeEntries, activeWeekStartMs, activeWeekEndMs]);

    const activeMonthTimeEntries = useMemo(() => {
        return timeEntries.filter((entry) => {
            const entryStartMs = Number(entry?.start || 0);
            return entryStartMs >= activeMonthStartMs && entryStartMs <= activeMonthEndMs;
        });
    }, [timeEntries, activeMonthStartMs, activeMonthEndMs]);

    // 1. Total Billed
    const totalBilledMs = useMemo(() => {
        return activeWeekTimeEntries.reduce((acc, entry) => acc + (Number(entry.duration) || 0), 0);
    }, [activeWeekTimeEntries]);
    const totalBilledHrs = totalBilledMs / (1000 * 60 * 60);
    const monthToDateBilledHrs = useMemo(() => {
        return activeMonthTimeEntries.reduce((acc, entry) => acc + ((Number(entry.duration) || 0) / (1000 * 60 * 60)), 0);
    }, [activeMonthTimeEntries]);

    // Gap calculations
    const gapToBase = Math.max(0, baseTarget - totalBilledHrs);
    const gapToStretch = Math.max(0, stretchTarget - totalBilledHrs);

    // Pacing Calculation
    let elapsedPace = 1;
    if (isCurrentWeek) {
        const dayOfWeek = (new Date().getDay() || 7) - 1; // 0 (Mon) to 6 (Sun)
        elapsedPace = Math.min(1, Math.max(0.1, (dayOfWeek + 1) / 5));
    } else if (!isPastWeek) {
        elapsedPace = 0; // Future weeks
    }
    const targetPaceHours = baseTarget * elapsedPace;
    const isPacingWell = totalBilledHrs >= targetPaceHours;

    // ----- Lead Accountability Data -----
    const leads = Object.keys(DEFAULT_LEAD_TARGETS);
    const [leadTargets, setLeadTargets] = useState<Record<string, number>>(() => {
        const map: Record<string, number> = { ...DEFAULT_LEAD_TARGETS };
        if (dbConfig?.leadConfigs) {
            dbConfig.leadConfigs.forEach((lc: any) => { map[lc.leadName] = lc.target; });
        }
        return map;
    });

    // ----- Client Pace Tracker Data (Lists) -----
    const [clientConfigs, setClientConfigs] = useState<Record<string, { clientName: string, orderIndex: number, team: number, sa: string, dealType: string, min: number, max: number, target: number, mtHrs: number, wPlusHrs: number }>>(() => {
        const map: Record<string, any> = {};
        if (dbConfig?.clientConfigs) {
            dbConfig.clientConfigs.forEach((cc: any) => {
                map[cc.clientId] = { clientName: cc.clientName ?? "", orderIndex: cc.orderIndex ?? 0, team: cc.team, sa: cc.sa, dealType: cc.dealType, min: cc.min, max: cc.max, target: cc.target, mtHrs: cc.mtHrs, wPlusHrs: cc.wPlusHrs };
            });
        }
        return map;
    });

    const clientDirectoryById = useMemo(() => {
        const map = new Map<string, any>();
        const rows = Array.isArray(dbConfig?.clientDirectory) ? dbConfig.clientDirectory : [];
        rows.forEach((row: any) => {
            const id = String(row?.id ?? "").trim();
            if (!id) return;
            map.set(id, row);
        });
        return map;
    }, [dbConfig?.clientDirectory]);

    const clients = useMemo(() => {
        const map = new Map<string, { id: string; name: string; orderIndex: number }>();

        Object.entries(clientConfigs).forEach(([id, cfg]) => {
            map.set(id, {
                id,
                name: cfg.clientName || id,
                orderIndex: Number(cfg.orderIndex ?? 9999),
            });
        });

        const gridRows = Array.isArray(dbConfig?.capacityGridConfig?.rows) ? dbConfig.capacityGridConfig.rows : [];
        gridRows.forEach((row: any, idx: number) => {
            const id = String(row?.id ?? "").trim();
            if (!id) return;
            const existing = map.get(id);
            const name = String(row?.client ?? "").trim() || id;
            if (existing) {
                if (!existing.name || existing.name === existing.id) {
                    existing.name = name;
                }
                return;
            }
            map.set(id, {
                id,
                name,
                orderIndex: 10000 + idx,
            });
        });

        return Array.from(map.values()).sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));
    }, [clientConfigs, dbConfig]);

    const capacityHoursByClientKey = useMemo(() => {
        const result = new Map<string, number>();
        const rows = Array.isArray(dbConfig?.capacityGridConfig?.rows) ? dbConfig.capacityGridConfig.rows : [];
        const resources = (Array.isArray(dbConfig?.capacityGridConfig?.resources) ? dbConfig.capacityGridConfig.resources : [])
            .filter((resource: any) => !Boolean(resource?.removed));

        rows.forEach((row: any) => {
            const allocations = row?.allocations || {};
            const total = resources.reduce((sum: number, resource: any) => {
                const hours = getAllocationHours(allocations?.[resource.id]);
                return sum + hours;
            }, 0);

            const idKey = normalizeName(String(row?.id ?? ""));
            const nameKey = normalizeName(String(row?.client ?? ""));
            if (idKey) result.set(idKey, total);
            if (nameKey) result.set(nameKey, total);
        });

        return result;
    }, [dbConfig?.capacityGridConfig]);

    const billedByClient = useMemo(() => {
        const map = new Map<string, number>();
        activeMonthTimeEntries.forEach(entry => {
            const taskMatch = tasksMap.get(entry.task?.id);
            const durationHours = (Number(entry.duration) || 0) / (1000 * 60 * 60);
            if (durationHours <= 0) return;
            const idKey = normalizeName(String(taskMatch?.list?.id ?? ""));
            const nameKey = normalizeName(String(taskMatch?.list?.name ?? ""));
            if (idKey) map.set(idKey, (map.get(idKey) || 0) + durationHours);
            if (nameKey) map.set(nameKey, (map.get(nameKey) || 0) + durationHours);
        });
        return map;
    }, [activeMonthTimeEntries, tasksMap]);

    const [consultantConfigs, setConsultantConfigs] = useState<Record<number, { maxCapacity: number, billableCapacity: number, notes: string }>>(() => {
        const map: Record<number, any> = {};
        if (dbConfig?.consultantConfigs) {
            dbConfig.consultantConfigs.forEach((cc: any) => {
                map[cc.consultantId] = { maxCapacity: cc.maxCapacity, billableCapacity: cc.billableCapacity, notes: cc.notes };
            });
        }
        return map;
    });

    const previousLeadTargets = useMemo(() => {
        const map: Record<string, number> = { ...DEFAULT_LEAD_TARGETS };
        if (dbConfig?.previousLeadConfigs) {
            dbConfig.previousLeadConfigs.forEach((lc: any) => { map[lc.leadName] = Number(lc.target ?? 0); });
        }
        return map;
    }, [dbConfig]);

    const previousConsultantConfigs = useMemo(() => {
        const map: Record<number, any> = {};
        if (dbConfig?.previousConsultantConfigs) {
            dbConfig.previousConsultantConfigs.forEach((cc: any) => {
                map[cc.consultantId] = {
                    maxCapacity: Number(cc.maxCapacity ?? 40),
                    billableCapacity: Number(cc.billableCapacity ?? 40),
                    mtHrs: Number(cc.mtHrs ?? 0),
                    wPlusHrs: Number(cc.wPlusHrs ?? 0),
                    notes: cc.notes ?? "",
                };
            });
        }
        return map;
    }, [dbConfig]);

    const previousClientConfigs = useMemo(() => {
        const map: Record<string, any> = {};
        if (dbConfig?.previousClientConfigs) {
            dbConfig.previousClientConfigs.forEach((cc: any) => {
                map[cc.clientId] = {
                    clientName: cc.clientName ?? "",
                    orderIndex: cc.orderIndex ?? 0,
                    team: cc.team ?? 0,
                    sa: cc.sa ?? "",
                    dealType: cc.dealType ?? "",
                    min: Number(cc.min ?? 0),
                    max: Number(cc.max ?? 0),
                    target: Number(cc.target ?? 0),
                    mtHrs: Number(cc.mtHrs ?? 0),
                    wPlusHrs: Number(cc.wPlusHrs ?? 0),
                };
            });
        }
        return map;
    }, [dbConfig]);

    // ----- DB Sync Effect -----
    // Triggers when navigating between weeks because the page.tsx sends a completely new dbConfig prop
    useEffect(() => {
        setBaseTarget(dbConfig?.weekConfig?.baseTarget ?? 350);
        setStretchTarget(dbConfig?.weekConfig?.stretchTarget ?? 400);

        const newLeads: Record<string, number> = { ...DEFAULT_LEAD_TARGETS };
        if (dbConfig?.leadConfigs) dbConfig.leadConfigs.forEach((lc: any) => { newLeads[lc.leadName] = lc.target; });
        setLeadTargets(newLeads);

        const newClients: Record<string, any> = {};
        if (dbConfig?.clientConfigs) dbConfig.clientConfigs.forEach((cc: any) => { newClients[cc.clientId] = { clientName: cc.clientName ?? "", orderIndex: cc.orderIndex ?? 0, team: cc.team, sa: cc.sa, dealType: cc.dealType, min: cc.min, max: cc.max, target: cc.target, mtHrs: cc.mtHrs, wPlusHrs: cc.wPlusHrs }; });
        setClientConfigs(newClients);

        const newConsultants: Record<number, any> = {};
        if (dbConfig?.consultantConfigs) dbConfig.consultantConfigs.forEach((cc: any) => { newConsultants[cc.consultantId] = { maxCapacity: cc.maxCapacity, billableCapacity: cc.billableCapacity, notes: cc.notes }; });
        setConsultantConfigs(newConsultants);
    }, [activeWeekStr, dbConfig]);

    const billedByConsultant = useMemo(() => {
        const map = new Map<number, number>();
        activeWeekTimeEntries.forEach(entry => {
            if (entry.user?.id) {
                const current = map.get(entry.user.id) || 0;
                map.set(entry.user.id, current + (Number(entry.duration) || 0));
            }
        });
        return map;
    }, [activeWeekTimeEntries]);

    const weeklyTrend = useMemo(() => {
        return Array.isArray(dbConfig?.weeklyTrend) ? dbConfig.weeklyTrend : [];
    }, [dbConfig]);

    const monthlyBaseTarget = useMemo(() => {
        return weeklyTrend.reduce((sum: number, row: any) => {
            const weekStartMs = new Date(`${String(row?.weekStart ?? "")}T00:00:00`).getTime();
            if (!Number.isFinite(weekStartMs) || weekStartMs < activeMonthStartMs || weekStartMs > activeMonthEndMs) {
                return sum;
            }
            return sum + Number(row?.baseTarget ?? 0);
        }, 0);
    }, [activeMonthEndMs, activeMonthStartMs, weeklyTrend]);

    const monthPacingTarget = monthlyBaseTarget * activeMonthProgress;
    const monthPacingStatus = monthToDateBilledHrs >= monthPacingTarget ? "ON TRACK" : "BEHIND";
    const monthPacingStatusClass = monthToDateBilledHrs >= monthPacingTarget ? "text-emerald-400" : "text-amber-300";
    const monthProgressLabel = `${Math.round(activeMonthProgress * 100)}% THROUGH MONTH`;

    const previousWeekStr = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
    const previousWeekDate = subWeeks(activeWeekDate, 1);
    const previousWeekPeriodLabel = `${format(previousWeekDate, "MM/dd")} to ${format(addDays(previousWeekDate, 4), "MM/dd")}`;

    const taskScopeLabelsByType = useMemo(() => {
        const listLabels = new Map<string, string>();
        const folderLabels = new Map<string, string>();
        tasks.forEach((task) => {
            const listId = String(task?.list?.id ?? "").trim();
            const listName = String(task?.list?.name ?? "").trim();
            const folderId = String(task?.folder?.id ?? "").trim();
            const folderName = String(task?.folder?.name ?? "").trim();
            if (listId && listName && !listLabels.has(listId)) listLabels.set(listId, listName);
            if (folderId && folderName && !folderLabels.has(folderId)) folderLabels.set(folderId, folderName);
        });
        return { listLabels, folderLabels };
    }, [tasks]);

    const buildCapacityHeaderMetrics = useMemo(() => {
        return (payload: any, consultantConfigMap: Record<number, any>, rollups: any[] = []): CapacityHeaderMetrics => {
            const resources = (Array.isArray(payload?.resources) ? payload.resources : []).filter((resource: any) => !Boolean(resource?.removed));
            const rows = Array.isArray(payload?.rows) ? payload.rows : [];

            const billableByName = new Map<string, number>();
            Object.entries(consultantConfigMap || {}).forEach(([consultantId, cfg]: any) => {
                const consultantIdNum = Number(consultantId);
                const consultantName = String(
                    resources.find((resource: any) => Number(resource?.consultantId ?? 0) === consultantIdNum)?.name
                    ?? ""
                ).trim();
                const billableCapacity = Number(cfg?.billableCapacity ?? 40);
                const fullKey = normalizeName(consultantName);
                const firstKey = normalizeName(consultantName.split(/\s+/)[0] || "");
                if (fullKey) billableByName.set(fullKey, billableCapacity);
                if (firstKey && !billableByName.has(firstKey)) billableByName.set(firstKey, billableCapacity);
            });

            const totalCapacity = resources.reduce((sum: number, resource: any) => {
                const consultantId = Number(resource?.consultantId ?? 0);
                if (consultantId > 0 && consultantConfigMap?.[consultantId]) {
                    return sum + Number(consultantConfigMap[consultantId]?.billableCapacity ?? 40);
                }
                const fullKey = normalizeName(String(resource?.name ?? ""));
                const firstKey = normalizeName(String(resource?.name ?? "").split(/\s+/)[0] || "");
                return sum + Number(billableByName.get(fullKey) ?? billableByName.get(firstKey) ?? 0);
            }, 0);

            const planned = rows.reduce((sum: number, row: any) => {
                return sum + resources.reduce((rowSum: number, resource: any) => {
                    return rowSum + Number(row?.allocations?.[resource.id]?.hours ?? 0);
                }, 0);
            }, 0);

            const wkMinTotal = rows.reduce((sum: number, row: any) => sum + Number(row?.wkMin ?? 0), 0);
            const wkMaxTotal = rows.reduce((sum: number, row: any) => sum + Number(row?.wkMax ?? 0), 0);

            const actuals = (Array.isArray(rollups) ? rollups : []).reduce((sum: number, rollup: any) => {
                const assigneeFullKey = normalizeName(String(rollup?.assignee ?? ""));
                const assigneeFirstKey = normalizeName(String(rollup?.assignee ?? "").split(/\s+/)[0] || "");
                const consultantMatch = resources.some((resource: any) => {
                    const resourceFullKey = normalizeName(String(resource?.name ?? ""));
                    const resourceFirstKey = normalizeName(String(resource?.name ?? "").split(/\s+/)[0] || "");
                    return (
                        (resourceFullKey && assigneeFullKey === resourceFullKey)
                        || (resourceFirstKey && assigneeFullKey === resourceFirstKey)
                        || (resourceFullKey && assigneeFirstKey === resourceFullKey)
                        || (resourceFirstKey && assigneeFirstKey === resourceFirstKey)
                    );
                });
                if (!consultantMatch) return sum;

                const scopeLabels = (() => {
                    const scopeType = String(rollup?.scopeType ?? "");
                    const scopeId = String(rollup?.scopeId ?? "");
                    if (scopeType === "list") {
                        return [taskScopeLabelsByType.listLabels.get(scopeId) ?? scopeId].filter(Boolean);
                    }
                    if (scopeType === "folder") {
                        return [taskScopeLabelsByType.folderLabels.get(scopeId) ?? scopeId].filter(Boolean);
                    }
                    return [scopeId].filter(Boolean);
                })();

                const rowMatch = rows.some((row: any) => {
                    const rowClientKey = normalizeName(String(row?.client ?? ""));
                    const rowIdKey = normalizeName(String(row?.id ?? ""));
                    return scopeLabels.some((label) => {
                        const labelKey = normalizeName(label);
                        return labelKey.length > 0 && (
                            labelKey === rowClientKey
                            || labelKey === rowIdKey
                            || labelKey.includes(rowClientKey)
                            || rowClientKey.includes(labelKey)
                        );
                    });
                });

                if (!rowMatch) return sum;
                return sum + Number(rollup?.hours ?? 0);
            }, 0);

            return {
                totalCapacity: Number(totalCapacity.toFixed(1)),
                planned: Number(planned.toFixed(1)),
                actuals: Number(actuals.toFixed(1)),
                wkMinTotal: Number(wkMinTotal.toFixed(1)),
                wkMaxTotal: Number(wkMaxTotal.toFixed(1)),
                gapToMin: Number((planned - wkMinTotal).toFixed(1)),
            };
        };
    }, [taskScopeLabelsByType]);

    const capacityGridWeeksByWeek = useMemo(() => {
        const map = new Map<string, any>();
        const rows = Array.isArray(dbConfig?.capacityGridConfigsForYear) ? dbConfig.capacityGridConfigsForYear : [];
        rows.forEach((row: any) => {
            const weekKey = String(row?.week ?? "");
            if (!weekKey) return;
            map.set(weekKey, row?.payload ?? null);
        });
        if (dbConfig?.capacityGridConfig) {
            map.set(activeWeekStr, dbConfig.capacityGridConfig);
        }
        return map;
    }, [activeWeekStr, dbConfig]);

    const currentCapacityMetrics = useMemo(
        () => buildCapacityHeaderMetrics(
            dbConfig?.capacityGridConfig,
            consultantConfigs,
            Array.isArray(dbConfig?.taskBillableRollups) ? dbConfig.taskBillableRollups : []
        ),
        [buildCapacityHeaderMetrics, consultantConfigs, dbConfig]
    );

    const previousCapacityMetrics = useMemo(
        () => buildCapacityHeaderMetrics(
            capacityGridWeeksByWeek.get(previousWeekStr),
            previousConsultantConfigs,
            Array.isArray(dbConfig?.previousTaskBillableRollups) ? dbConfig.previousTaskBillableRollups : []
        ),
        [buildCapacityHeaderMetrics, capacityGridWeeksByWeek, dbConfig, previousConsultantConfigs, previousWeekStr]
    );

    const buildWeekAtGlanceCards = (metrics: CapacityHeaderMetrics) => ([
        { label: "Consultant Total Capacity", value: metrics.totalCapacity, accent: "text-white" },
        { label: "Planned", value: metrics.planned, accent: "text-white" },
        { label: "Actuals", value: metrics.actuals, accent: "text-white" },
        { label: "WK Min Total", value: metrics.wkMinTotal, accent: "text-white" },
        { label: "WK Max Total", value: metrics.wkMaxTotal, accent: "text-white" },
        {
            label: "Gap vs WK Min",
            value: metrics.gapToMin,
            accent: metrics.gapToMin >= 0 ? "text-white" : "text-slate-400",
            lane: metrics.gapToMin >= 0 ? "" : "bg-slate-500/10",
        },
    ]);

    const previousWeekCards = buildWeekAtGlanceCards(previousCapacityMetrics);
    const currentWeekCards = buildWeekAtGlanceCards(currentCapacityMetrics);

    return (
        <div className="flex flex-col space-y-8 pb-32 px-1">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                            Command Center
                        </h2>

                        <div className="flex items-center bg-surface border border-border rounded overflow-hidden">
                            <button disabled={isNavigationBlocked} onClick={handlePrevWeek} className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors disabled:opacity-50">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button disabled={isWeekLoading} onClick={handleCurrentWeek} className="px-3 py-1 text-xs font-medium text-white hover:bg-surface-hover transition-colors border-l border-r border-border disabled:opacity-50">
                                {isCurrentWeek ? "Current Week" : format(activeWeekDate, "MMM d, yyyy")}
                            </button>
                            <button disabled={isNavigationBlocked} onClick={handleNextWeek} className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors disabled:opacity-50">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {isPastWeek && (
                            <span className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                                Read-Only History
                            </span>
                        )}
                    </div>

                    <div className="text-xs text-text-muted bg-surface-hover px-3 py-1.5 rounded border border-border">
                        Auto-synced with ClickUp Time Entries
                    </div>
                </div>

            <div className="space-y-4">
                <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                        <div className="px-5 py-3 border-b border-border/50 bg-surface/30">
                            <h3 className="text-sm font-semibold text-text-main">LAST WEEK AT A GLANCE — {previousWeekPeriodLabel}</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-border/40">
                            {previousWeekCards.map((card) => (
                                <div key={card.label} className={cn("p-4", card.lane)}>
                                    <div className="text-[11px] uppercase text-text-muted">{card.label}</div>
                                    <div className={cn("mt-1 text-3xl font-bold", card.accent)}>{card.value.toFixed(1)}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                        <div className="px-5 py-3 border-b border-border/50 bg-surface/30">
                            <h3 className="text-sm font-semibold text-text-main">THIS WEEK AT A GLANCE</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-border/40">
                            {currentWeekCards.map((card) => (
                                <div key={card.label} className={cn("p-4", card.lane)}>
                                    <div className="text-[11px] uppercase text-text-muted">{card.label}</div>
                                    <div className={cn("mt-1 text-3xl font-bold", card.accent)}>{card.value.toFixed(1)}</div>
                                </div>
                            ))}
                        </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border/60 bg-[linear-gradient(180deg,rgba(39,32,74,0.92)_0%,rgba(27,24,49,0.96)_100%)] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
                    <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                        <h3 className="text-lg font-semibold text-white">MONTH AT A GLANCE — {activeMonthLabel}</h3>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-200/80">{monthProgressLabel}</div>
                    </div>
                    <div className="grid grid-cols-1 divide-y divide-white/10 md:grid-cols-[1fr_1fr_0.9fr] md:divide-x md:divide-y-0">
                        <div className="px-6 py-8">
                            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-200/70">Month To Date Billed</div>
                            <div className="mt-4 text-5xl font-bold leading-none text-white">{monthToDateBilledHrs.toFixed(1)}</div>
                        </div>
                        <div className="px-6 py-8">
                            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-200/70">Monthly Base Target</div>
                            <div className="mt-4 text-5xl font-bold leading-none text-white">{monthlyBaseTarget.toFixed(0)}</div>
                        </div>
                        <div className="bg-white/[0.02] px-6 py-8">
                            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-200/70">Month Pacing Status</div>
                            <div className={cn("mt-4 text-5xl font-bold leading-none", monthPacingStatusClass)}>{monthPacingStatus}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Client Pace Tracker Grid */}
            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-sm font-semibold text-text-main">CLIENT PACE TRACKER — {activeMonthLabel}</h3>
                    </div>
                    <div className="text-xs text-text-muted">
                        Monthly planned vs monthly billed. Client turns red when billed hours exceed the month max.
                    </div>
                </div>
                <div className="overflow-x-auto text-[13px]">
                    {(() => {
                        const capacityGridRows = Array.isArray(dbConfig?.capacityGridConfig?.rows) ? dbConfig.capacityGridConfig.rows : [];
                        const capacityGridResources = (Array.isArray(dbConfig?.capacityGridConfig?.resources) ? dbConfig.capacityGridConfig.resources : [])
                            .filter((resource: any) => !Boolean(resource?.removed));

                        const monthCapacityRows = new Map<string, {
                            client: string;
                            team: number;
                            sa: string;
                            dealType: string;
                            wkMax: number;
                            monthlyMax: number;
                            plannedHours: number;
                        }>();

                        const capacityGridWeeks = new Map<string, any>();
                        const capacityGridConfigsForYear = Array.isArray(dbConfig?.capacityGridConfigsForYear) ? dbConfig.capacityGridConfigsForYear : [];
                        capacityGridConfigsForYear.forEach((weekRow: any) => {
                            const weekKey = String(weekRow?.week ?? "");
                            if (!weekKey) return;
                            capacityGridWeeks.set(weekKey, weekRow?.payload ?? null);
                        });
                        if (!capacityGridWeeks.has(activeWeekStr) && dbConfig?.capacityGridConfig) {
                            capacityGridWeeks.set(activeWeekStr, dbConfig.capacityGridConfig);
                        }

                        capacityGridWeeks.forEach((payload: any, weekKey: string) => {
                            const weekMs = new Date(`${weekKey}T00:00:00`).getTime();
                            if (!Number.isFinite(weekMs) || weekMs < activeMonthStartMs || weekMs > activeMonthEndMs) return;

                            const rows = Array.isArray(payload?.rows) ? payload.rows : [];
                            const resources = (Array.isArray(payload?.resources) ? payload.resources : [])
                                .filter((resource: any) => !Boolean(resource?.removed));

                            rows.forEach((row: any, idx: number) => {
                                const rowId = String(row?.id ?? `row-${idx + 1}`);
                                const clientDirectory = clientDirectoryById.get(rowId);
                                const existing = monthCapacityRows.get(rowId) ?? {
                                    client: String(clientDirectory?.name ?? row?.client ?? "Client"),
                                    team: Number(clientDirectory?.team ?? row?.team ?? clientConfigs[rowId]?.team ?? 0),
                                    sa: String(clientDirectory?.sa ?? row?.teamSa ?? ""),
                                    dealType: String(clientDirectory?.dealType ?? row?.dealType ?? ""),
                                    wkMax: Number(clientDirectory?.max ?? row?.wkMax ?? 0),
                                    monthlyMax: 0,
                                    plannedHours: 0,
                                };

                                const allocations = row?.allocations || {};
                                const rowPlannedHours = resources.reduce((sum: number, resource: any) => {
                                    return sum + getAllocationHours(allocations?.[resource.id]);
                                }, 0);

                                existing.client = existing.client || String(clientDirectory?.name ?? row?.client ?? rowId);
                                existing.team = Number(existing.team || clientDirectory?.team || row?.team || clientConfigs[rowId]?.team || 0);
                                existing.sa = existing.sa || String(clientDirectory?.sa ?? row?.teamSa ?? "");
                                existing.dealType = existing.dealType || String(clientDirectory?.dealType ?? row?.dealType ?? "");
                                existing.wkMax = Number(existing.wkMax || clientDirectory?.max || row?.wkMax || 0);
                                existing.monthlyMax += Number(clientDirectory?.max ?? row?.wkMax ?? 0);
                                existing.plannedHours += Number(rowPlannedHours ?? 0);

                                monthCapacityRows.set(rowId, existing);
                            });
                        });

                        const cptRows: ClientPaceTrackerRow[] = capacityGridRows.map((row: any, idx: number) => {
                            const rowId = String(row?.id ?? `row-${idx + 1}`);
                            const monthlyCapacity = monthCapacityRows.get(rowId);
                            const clientDirectory = clientDirectoryById.get(rowId);
                            const idKey = normalizeName(rowId);
                            const nameKey = normalizeName(String(row?.client ?? ""));
                            const billedHours = Number(
                                billedByClient.get(idKey)
                                ?? billedByClient.get(nameKey)
                                ?? 0
                            );
                            const wkMax = Number(clientDirectory?.max ?? row?.wkMax ?? monthlyCapacity?.wkMax ?? 0);
                            const monthlyMax = Number(monthlyCapacity?.monthlyMax ?? 0);
                            const plannedHours = Number(monthlyCapacity?.plannedHours ?? 0);
                            const isPlannedOverMonthlyMax = monthlyMax > 0 && plannedHours > monthlyMax;
                            const isOverMonthlyMax = monthlyMax > 0 && billedHours > monthlyMax;
                            const isUnderWeeklyMax = wkMax > 0 && plannedHours <= wkMax;
                            const statusLabel = isOverMonthlyMax
                                ? "Billed Over Max"
                                : isPlannedOverMonthlyMax
                                    ? "Planned Over Max"
                                    : isUnderWeeklyMax
                                        ? "Under Wk Max"
                                        : "OK";
                            const teamFromConfig = clientConfigs[rowId]?.team;

                            return {
                                id: rowId,
                                team: Number(clientDirectory?.team ?? row?.team ?? teamFromConfig ?? monthlyCapacity?.team ?? 0),
                                client: String(clientDirectory?.name ?? row?.client ?? monthlyCapacity?.client ?? "Client"),
                                sa: String(clientDirectory?.sa ?? row?.teamSa ?? monthlyCapacity?.sa ?? ""),
                                dealType: String(clientDirectory?.dealType ?? row?.dealType ?? monthlyCapacity?.dealType ?? ""),
                                wkMax,
                                plannedHours,
                                billedHours,
                                monthlyMax,
                                isPlannedOverMonthlyMax,
                                isOverMonthlyMax,
                                statusLabel,
                            };
                        });

                        const cptTotals = cptRows.reduce((
                            acc: { max: number; monthlyMax: number; plannedHours: number; billedHours: number },
                            row: any
                        ) => {
                            acc.max += row.wkMax;
                            acc.monthlyMax += row.monthlyMax;
                            acc.plannedHours += row.plannedHours;
                            acc.billedHours += row.billedHours;
                            return acc;
                        }, { max: 0, monthlyMax: 0, plannedHours: 0, billedHours: 0 });

                        return (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b-2 border-border/50 text-text-muted text-[11px] font-bold tracking-wider bg-[#1a2035]/80 text-[#94a3b8] cap-none">
                                        <th className="px-5 py-2.5 font-medium w-16 text-right border-r border-dashed border-blue-400/30">Team</th>
                                        <th className="px-5 py-2.5 font-medium min-w-[160px] border-r border-dashed border-blue-400/30">Client</th>
                                        <th className="px-5 py-2.5 font-medium w-32 border-r border-dashed border-blue-400/30">SA</th>
                                        <th className="px-5 py-2.5 font-medium w-32 border-r border-dashed border-blue-400/30">Deal Type</th>
                                        <th className="px-5 py-2.5 font-medium w-24 text-right border-r border-dashed border-blue-400/30">Wk Max</th>
                                        <th className="px-5 py-2.5 font-medium w-28 text-right border-r border-dashed border-blue-400/30">Month Max</th>
                                        <th className="px-5 py-2.5 font-medium w-28 font-bold text-white text-right border-r border-dashed border-blue-400/30 bg-indigo-500/10">Planned (Month)</th>
                                        <th className="px-5 py-2.5 font-medium w-28 font-bold text-white text-right border-r border-dashed border-blue-400/30 bg-cyan-500/10">Billed (Month)</th>
                                        <th className="px-5 py-2.5 font-medium w-24 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {cptRows.map((row) => {
                                        return (
                                            <tr key={row.id} className="hover:bg-surface/30 transition-colors">
                                                <td className="px-5 py-2 text-text-muted border-r border-dashed border-blue-400/30 text-right tabular-nums text-xs">
                                                    {row.team > 0 ? row.team : "-"}
                                                </td>
                                                <td className={cn(
                                                    "px-5 py-2 font-medium border-r border-dashed border-blue-400/30",
                                                    row.isOverMonthlyMax
                                                        ? "text-red-400"
                                                        : row.isPlannedOverMonthlyMax
                                                        ? "text-amber-300"
                                                        : "text-text-main"
                                                )}>
                                                    <span className="text-xs font-medium">{row.client}</span>
                                                </td>
                                                <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-[11px] text-text-main">
                                                    {row.sa || "-"}
                                                </td>
                                                <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-[11px] text-text-main">
                                                    {row.dealType || "-"}
                                                </td>
                                                <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-text-main text-right tabular-nums text-xs">
                                                    {row.wkMax > 0 ? row.wkMax.toFixed(1) : "-"}
                                                </td>
                                                <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-text-main text-right tabular-nums text-xs">
                                                    {row.monthlyMax > 0 ? row.monthlyMax.toFixed(1) : "-"}
                                                </td>
                                                <td className="px-5 py-2 bg-indigo-500/10 font-bold text-white text-right border-r border-dashed border-blue-400/30">
                                                    {row.plannedHours > 0 ? row.plannedHours.toFixed(1) : "0"}
                                                </td>
                                                <td className={cn("px-5 py-2 font-bold text-right border-r border-dashed border-blue-400/30", row.isOverMonthlyMax ? "bg-red-500/15 text-red-300" : "bg-cyan-500/10 text-cyan-100")}>
                                                    {row.billedHours > 0 ? row.billedHours.toFixed(1) : "0"}
                                                </td>
                                                <td className={cn(
                                                    "px-5 py-2 text-center text-xs font-semibold",
                                                    row.isOverMonthlyMax
                                                        ? "text-red-400"
                                                        : row.isPlannedOverMonthlyMax
                                                        ? "text-amber-300"
                                                        : "text-emerald-400"
                                                )}>
                                                    {row.statusLabel}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-indigo-500/10 font-bold border-t border-border/50">
                                    <tr>
                                        <td colSpan={4} className="px-5 py-2.5 text-text-main text-[12px] uppercase tracking-wider text-right">TOTAL</td>
                                        <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{cptTotals.max > 0 ? cptTotals.max.toFixed(1) : "0"}</td>
                                        <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{cptTotals.monthlyMax > 0 ? cptTotals.monthlyMax.toFixed(1) : "0"}</td>
                                        <td className="px-5 py-2.5 text-white font-bold text-[13px] text-right">{cptTotals.plannedHours > 0 ? cptTotals.plannedHours.toFixed(1) : "0"}</td>
                                        <td className="px-5 py-2.5 text-white font-bold text-[13px] text-right">{cptTotals.billedHours > 0 ? cptTotals.billedHours.toFixed(1) : "0"}</td>
                                        <td className="px-5 py-2.5 text-center text-xs"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        );
                    })()}
                </div>
            </div>

        </div>
    );
}
