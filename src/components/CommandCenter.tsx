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

export function CommandCenter({ tasks, timeEntries, activeWeekStr, dbConfig }: CommandCenterProps) {
    const router = useRouter();

    // ----- Date & Week Logic -----
    // Append time to ensure we parse the exact UTC day without local timezone shift
    const activeWeekDate = new Date(activeWeekStr + 'T00:00:00');

    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const currentWeekStartStr = format(currentWeekStart, 'yyyy-MM-dd');

    const isPastWeek = activeWeekStr < currentWeekStartStr;
    const isCurrentWeek = activeWeekStr === currentWeekStartStr;

    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=command-center`;

    const handlePrevWeek = () => {
        router.push(weekParamFor(subWeeks(activeWeekDate, 1)));
    };
    const handleNextWeek = () => {
        router.push(weekParamFor(addWeeks(activeWeekDate, 1)));
    };
    const handleCurrentWeek = () => {
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

    const weekLookup = useMemo(() => {
        const map = new Map<string, { totalHours: number }>();
        weeklyTrend.forEach((row: any) => {
            map.set(row.weekStart, { totalHours: Number(row.totalHours || 0) });
        });
        return map;
    }, [weeklyTrend]);

    const previousWeekStr = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
    const previousWeekDate = subWeeks(activeWeekDate, 1);
    const previousWeekPeriodLabel = `${format(previousWeekDate, "MM/dd")} to ${format(addDays(previousWeekDate, 4), "MM/dd")}`;
    const thisWeekHours = weekLookup.get(activeWeekStr)?.totalHours ?? totalBilledHrs;
    const lastWeekHours = weekLookup.get(previousWeekStr)?.totalHours ?? 0;
    const thisWeekBaseTarget = Number(dbConfig?.weekConfig?.baseTarget ?? 350);
    const thisWeekStretchTarget = Number(dbConfig?.weekConfig?.stretchTarget ?? 400);
    const lastWeekTrendRow = weeklyTrend.find((row: any) => row.weekStart === previousWeekStr);
    const lastWeekBaseTarget = Number(lastWeekTrendRow?.baseTarget ?? 350);
    const lastWeekStretchTarget = Number(lastWeekTrendRow?.stretchTarget ?? 400);

    const billableCapacityTotal = useMemo(() => {
        const configuredValues = Object.values(consultantConfigs).map((cfg: any) => Number(cfg.billableCapacity || 0));
        return configuredValues.reduce((sum, hrs) => sum + hrs, 0);
    }, [consultantConfigs]);

    const previousBillableCapacityTotal = useMemo(() => {
        const configuredValues = Object.values(previousConsultantConfigs).map((cfg: any) => Number(cfg.billableCapacity || 0));
        return configuredValues.reduce((sum, hrs) => sum + hrs, 0);
    }, [previousConsultantConfigs]);

    const thisWeekInitialForecast = useMemo(() => {
        return clients.reduce((sum, client) => {
            const cfg = clientConfigs[client.id];
            const fallbackTotal = Number(cfg?.mtHrs ?? 0) + Number(cfg?.wPlusHrs ?? 0);
            const idKey = normalizeName(client.id);
            const nameKey = normalizeName(client.name);
            const capacityTotal = capacityHoursByClientKey.get(idKey) ?? capacityHoursByClientKey.get(nameKey);
            return sum + Number(capacityTotal ?? fallbackTotal);
        }, 0);
    }, [clients, clientConfigs, capacityHoursByClientKey]);

    const lastWeekInitialForecast = useMemo(() => {
        return Object.values(previousClientConfigs).reduce((sum: number, cfg: any) => {
            return sum + Number(cfg?.mtHrs ?? 0) + Number(cfg?.wPlusHrs ?? 0);
        }, 0);
    }, [previousClientConfigs]);
    const thisWeekBillableTarget = leads.reduce((sum, lead) => sum + Number(leadTargets[lead] || 0), 0);
    const lastWeekBillableTarget = leads.reduce((sum, lead) => sum + Number(previousLeadTargets[lead] || 0), 0);
    const lastWeekGapToTarget = Math.max(0, lastWeekBaseTarget - lastWeekHours);
    const thisWeekGapToTarget = Math.max(0, thisWeekBaseTarget - thisWeekHours);
    const lastWeekGapToWkTarget = Math.max(0, lastWeekBillableTarget - lastWeekHours);
    const thisWeekGapToWkTarget = Math.max(0, thisWeekBillableTarget - thisWeekHours);

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
                            <button onClick={handlePrevWeek} className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button onClick={handleCurrentWeek} className="px-3 py-1 text-xs font-medium text-white hover:bg-surface-hover transition-colors border-l border-r border-border">
                                {isCurrentWeek ? "Current Week" : format(activeWeekDate, "MMM d, yyyy")}
                            </button>
                            <button onClick={handleNextWeek} className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors">
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
                        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-8 divide-y md:divide-y-0 md:divide-x divide-border/40">
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Initial Forecast (Mon)</div>
                                <div className="text-3xl font-bold text-white mt-1">{lastWeekInitialForecast.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Total Billed</div>
                                <div className="text-3xl font-bold text-white mt-1">{lastWeekHours.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Gap to Target</div>
                                <div className={cn("text-3xl font-bold mt-1", lastWeekGapToTarget === 0 ? "text-emerald-400" : "text-red-400")}>{lastWeekGapToTarget.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Gap to Stretch</div>
                                <div className="text-3xl font-bold mt-1 text-red-400">{Math.max(0, lastWeekStretchTarget - lastWeekHours).toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">M/T Pace</div>
                                <div className="text-3xl font-bold text-white mt-1">{lastWeekBaseTarget > 0 ? ((lastWeekHours / lastWeekBaseTarget) * 100).toFixed(0) : "0"}%</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Billable Capacity</div>
                                <div className="text-3xl font-bold text-white mt-1">{previousBillableCapacityTotal.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Billable Target</div>
                                <div className="text-3xl font-bold text-white mt-1">{lastWeekBillableTarget.toFixed(1)}</div>
                            </div>
                            <div className={cn("p-4", lastWeekGapToWkTarget === 0 ? "bg-emerald-500/10" : "bg-red-500/10")}>
                                <div className="text-[11px] uppercase text-text-muted">Gap to Wk Target</div>
                                <div className={cn("text-3xl font-bold mt-1", lastWeekGapToWkTarget === 0 ? "text-emerald-400" : "text-red-400")}>{lastWeekGapToWkTarget.toFixed(1)}</div>
                            </div>
                        </div>
                        <div className="px-5 py-2 border-t border-border/40 text-xs text-text-muted bg-surface/10">
                            {lastWeekBaseTarget > 0 ? ((lastWeekHours / lastWeekBaseTarget) * 100).toFixed(0) : "0"}% of {lastWeekBaseTarget.toFixed(0)} hr target
                        </div>
                    </div>

                <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                        <div className="px-5 py-3 border-b border-border/50 bg-surface/30">
                            <h3 className="text-sm font-semibold text-text-main">THIS WEEK AT A GLANCE</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-8 divide-y md:divide-y-0 md:divide-x divide-border/40">
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Initial Forecast (Mon)</div>
                                <div className="text-3xl font-bold text-white mt-1">{thisWeekInitialForecast.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Total Billable by Fri</div>
                                <div className="text-3xl font-bold text-white mt-1">{thisWeekHours.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Gap to Target</div>
                                <div className={cn("text-3xl font-bold mt-1", thisWeekGapToTarget === 0 ? "text-emerald-400" : "text-red-400")}>{thisWeekGapToTarget.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Gap to Stretch</div>
                                <div className="text-3xl font-bold mt-1 text-red-400">{Math.max(0, thisWeekStretchTarget - thisWeekHours).toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">M/T Pace</div>
                                <div className="text-3xl font-bold text-white mt-1">{thisWeekBaseTarget > 0 ? ((thisWeekHours / thisWeekBaseTarget) * 100).toFixed(0) : "0"}%</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Billable Capacity</div>
                                <div className="text-3xl font-bold text-white mt-1">{billableCapacityTotal.toFixed(1)}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-[11px] uppercase text-text-muted">Billable Target</div>
                                <div className="text-3xl font-bold text-white mt-1">{thisWeekBillableTarget.toFixed(1)}</div>
                            </div>
                            <div className={cn("p-4", thisWeekGapToWkTarget === 0 ? "bg-emerald-500/10" : "bg-red-500/10")}>
                                <div className="text-[11px] uppercase text-text-muted">Gap to Wk Target</div>
                                <div className={cn("text-3xl font-bold mt-1", thisWeekGapToWkTarget === 0 ? "text-emerald-400" : "text-red-400")}>{thisWeekGapToWkTarget.toFixed(1)}</div>
                            </div>
                        </div>
                        <div className="px-5 py-2 border-t border-border/40 text-xs text-text-muted bg-surface/10">
                            {thisWeekBaseTarget > 0 ? ((thisWeekHours / thisWeekBaseTarget) * 100).toFixed(0) : "0"}% of {thisWeekBaseTarget.toFixed(0)} hr target
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
                                const existing = monthCapacityRows.get(rowId) ?? {
                                    client: String(row?.client ?? "Client"),
                                    team: Number(row?.team ?? clientConfigs[rowId]?.team ?? 0),
                                    sa: String(row?.teamSa ?? ""),
                                    dealType: String(row?.dealType ?? ""),
                                    wkMax: Number(row?.wkMax ?? 0),
                                    monthlyMax: 0,
                                    plannedHours: 0,
                                };

                                const allocations = row?.allocations || {};
                                const rowPlannedHours = resources.reduce((sum: number, resource: any) => {
                                    return sum + getAllocationHours(allocations?.[resource.id]);
                                }, 0);

                                existing.client = existing.client || String(row?.client ?? rowId);
                                existing.team = Number(existing.team || row?.team || clientConfigs[rowId]?.team || 0);
                                existing.sa = existing.sa || String(row?.teamSa ?? "");
                                existing.dealType = existing.dealType || String(row?.dealType ?? "");
                                existing.wkMax = Number(existing.wkMax || row?.wkMax || 0);
                                existing.monthlyMax += Number(row?.wkMax ?? 0);
                                existing.plannedHours += Number(rowPlannedHours ?? 0);

                                monthCapacityRows.set(rowId, existing);
                            });
                        });

                        const cptRows: ClientPaceTrackerRow[] = capacityGridRows.map((row: any, idx: number) => {
                            const rowId = String(row?.id ?? `row-${idx + 1}`);
                            const monthlyCapacity = monthCapacityRows.get(rowId);
                            const idKey = normalizeName(rowId);
                            const nameKey = normalizeName(String(row?.client ?? ""));
                            const billedHours = Number(
                                billedByClient.get(idKey)
                                ?? billedByClient.get(nameKey)
                                ?? 0
                            );
                            const wkMax = Number(row?.wkMax ?? monthlyCapacity?.wkMax ?? 0);
                            const monthlyMax = Number(monthlyCapacity?.monthlyMax ?? 0);
                            const plannedHours = Number(monthlyCapacity?.plannedHours ?? 0);
                            const isPlannedOverMonthlyMax = monthlyMax > 0 && plannedHours > monthlyMax;
                            const isOverMonthlyMax = monthlyMax > 0 && billedHours > monthlyMax;
                            const statusLabel = isOverMonthlyMax ? "Billed Over Max" : isPlannedOverMonthlyMax ? "Planned Over Max" : "OK";
                            const teamFromConfig = clientConfigs[rowId]?.team;

                            return {
                                id: rowId,
                                team: Number(row?.team ?? teamFromConfig ?? monthlyCapacity?.team ?? 0),
                                client: String(row?.client ?? monthlyCapacity?.client ?? "Client"),
                                sa: String(row?.teamSa ?? monthlyCapacity?.sa ?? ""),
                                dealType: String(row?.dealType ?? monthlyCapacity?.dealType ?? ""),
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
