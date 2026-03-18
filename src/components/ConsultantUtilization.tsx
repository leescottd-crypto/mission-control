"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, RotateCcw, Trash2, Users, X } from "lucide-react";
import { updateConsultantConfig, updateCapacityGridConfig, CapacityGridPayload } from "@/app/actions";
import { cn } from "@/lib/utils";

interface ConsultantUtilizationProps {
    activeWeekStr: string;
    consultants: Array<{ id: number; name: string }>;
    consultantConfigsById: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>;
    capacityGrid: CapacityGridPayload;
    onConsultantConfigChange?: (
        consultantId: number,
        patch: Partial<{ maxCapacity: number; billableCapacity: number; notes: string }>
    ) => void;
    onCapacityGridChange?: (nextGrid: CapacityGridPayload) => void;
}

type RosterConfirmState = {
    resourceId: string;
    consultantName: string;
    action: "hide" | "reinstate";
};

function normalizeName(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getAllocationHours(cell: unknown) {
    const legacyCell = cell as { hours?: number; wt?: number; wPlus?: number } | undefined;
    return Number(legacyCell?.hours ?? Number(legacyCell?.wt ?? 0) + Number(legacyCell?.wPlus ?? 0));
}

export function ConsultantUtilization({
    activeWeekStr,
    consultants,
    consultantConfigsById,
    capacityGrid,
    onConsultantConfigChange,
    onCapacityGridChange,
}: ConsultantUtilizationProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isWeekNavLocked, setIsWeekNavLocked] = useState(false);
    const [activeRosterTab, setActiveRosterTab] = useState<"active" | "removed">("active");
    const [rosterConfirm, setRosterConfirm] = useState<RosterConfirmState | null>(null);
    const navUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeWeekDate = new Date(activeWeekStr + "T00:00:00");
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isPastWeek = activeWeekStr < format(currentWeekStart, "yyyy-MM-dd");
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;
    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;

    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=consultant-utilization`;
    const navigateToWeek = (nextDate: Date | null) => {
        if (isWeekNavLocked) return;
        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (nextDate === null && activeWeekStr === currentWeekStr) return;
        if (nextDate && format(nextDate, "yyyy-MM-dd") === activeWeekStr) return;

        const href = nextDate ? weekParamFor(nextDate) : "/?tab=consultant-utilization";
        setIsWeekNavLocked(true);
        router.push(href);
        navUnlockTimerRef.current = setTimeout(() => {
            setIsWeekNavLocked(false);
            navUnlockTimerRef.current = null;
        }, 500);
    };
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
        setIsWeekNavLocked(false);
        if (navUnlockTimerRef.current) {
            clearTimeout(navUnlockTimerRef.current);
            navUnlockTimerRef.current = null;
        }
    }, [activeWeekStr]);

    useEffect(() => {
        return () => {
            if (navUnlockTimerRef.current) clearTimeout(navUnlockTimerRef.current);
        };
    }, []);

    const consultantsForDisplay = useMemo(() => {
        const resources = Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [];
        if (resources.length > 0) {
            return resources
                .map((resource: any, idx: number) => ({
                    id: Number(resource?.consultantId ?? -(idx + 1)),
                    name: String(resource?.name ?? "").trim(),
                    resourceId: String(resource?.id ?? `resource-${idx + 1}`),
                    removed: Boolean(resource?.removed ?? false),
                }))
                .filter((consultant) => consultant.name.length > 0)
                .sort((a, b) => a.name.localeCompare(b.name));
        }

        return consultants
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((consultant) => ({
                ...consultant,
                resourceId: "",
                removed: false,
            }));
    }, [capacityGrid?.resources, consultants]);

    const activeConsultants = useMemo(
        () => consultantsForDisplay.filter((consultant) => !consultant.removed),
        [consultantsForDisplay]
    );

    const removedConsultants = useMemo(
        () => consultantsForDisplay.filter((consultant) => consultant.removed),
        [consultantsForDisplay]
    );

    const consultantsForCurrentTab = activeRosterTab === "active" ? activeConsultants : removedConsultants;

    const capacityHoursByConsultant = useMemo(() => {
        const byId = new Map<number, number>();
        const byName = new Map<string, number>();

        const resources = Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [];
        const rows = Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [];

        resources
            .filter((resource: any) => !Boolean(resource?.removed))
            .forEach((resource: any) => {
            const consultantId = Number(resource?.consultantId ?? 0);
            if (consultantId > 0 && !byId.has(consultantId)) byId.set(consultantId, 0);
            const nameKey = normalizeName(resource?.name ?? "");
            if (nameKey && !byName.has(nameKey)) byName.set(nameKey, 0);
        });

        rows.forEach((row: any) => {
            const allocations = row?.allocations || {};
            resources
            .filter((resource: any) => !Boolean(resource?.removed))
            .forEach((resource: any) => {
                const cell = allocations[resource.id] || {};
                const hours = getAllocationHours(cell);
                const consultantId = Number(resource?.consultantId ?? 0);
                if (consultantId > 0) {
                    byId.set(consultantId, Number(byId.get(consultantId) ?? 0) + hours);
                }
                const nameKey = normalizeName(resource?.name ?? "");
                if (nameKey) {
                    byName.set(nameKey, Number(byName.get(nameKey) ?? 0) + hours);
                }
            });
        });

        return { byId, byName };
    }, [capacityGrid]);

    const persistConsultant = (
        consultantId: number,
        patch: Partial<{ maxCapacity: number; billableCapacity: number; notes: string }>
    ) => {
        const current = consultantConfigsById[consultantId] || { maxCapacity: 40, billableCapacity: 40, notes: "" };
        const next = { ...current, ...patch };
        startTransition(() => {
            updateConsultantConfig(activeWeekStr, consultantId, {
                maxCapacity: Number(next.maxCapacity ?? 40),
                billableCapacity: Number(next.billableCapacity ?? 40),
                notes: String(next.notes ?? ""),
            });
        });
    };

    const persistCapacityGrid = (nextGrid: CapacityGridPayload) => {
        onCapacityGridChange?.(nextGrid);
        startTransition(() => {
            updateCapacityGridConfig(activeWeekStr, nextGrid);
        });
    };

    const handleRemoveConsultant = (resourceId: string, consultantName: string) => {
        setRosterConfirm({ resourceId, consultantName, action: "hide" });
    };

    const handleConfirmRemoveConsultant = (resourceId: string) => {
        const nextResources = (Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [])
            .map((resource: any, idx: number) => {
                if (String(resource?.id ?? "") !== resourceId) {
                    return {
                        ...resource,
                        orderIndex: idx,
                    };
                }
                return {
                    ...resource,
                    removed: true,
                    orderIndex: idx,
                };
            })
            .map((resource: any, idx: number) => ({
                ...resource,
                orderIndex: idx,
            }));

        persistCapacityGrid({
            resources: nextResources,
            rows: Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [],
        });
    };

    const handleReinstateConsultant = (resourceId: string, consultantName: string) => {
        setRosterConfirm({ resourceId, consultantName, action: "reinstate" });
    };

    const handleConfirmReinstateConsultant = (resourceId: string) => {
        const nextResources = (Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [])
            .map((resource: any, idx: number) => ({
                ...(String(resource?.id ?? "") === resourceId ? { ...resource, removed: false } : resource),
                orderIndex: idx,
            }));

        persistCapacityGrid({
            resources: nextResources,
            rows: Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [],
        });
    };

    const totalsRow = activeConsultants.reduce((acc, consultant) => {
        const cfg = consultantConfigsById[consultant.id] || { maxCapacity: 40, billableCapacity: 40, notes: "" };
        const hours =
            capacityHoursByConsultant.byId.get(consultant.id) ||
            capacityHoursByConsultant.byName.get(normalizeName(consultant.name)) ||
            0;
        const total = Number(hours || 0);
        acc.max += Number(cfg.maxCapacity || 0);
        acc.billable += Number(cfg.billableCapacity || 0);
        acc.total += total;
        acc.available += Math.max(0, Number(cfg.billableCapacity || 0) - total);
        return acc;
    }, { max: 0, billable: 0, total: 0, available: 0 });

    const utilizationPct = totalsRow.billable > 0 ? (totalsRow.total / totalsRow.billable) * 100 : 0;

    const handleConfirmRosterAction = () => {
        if (!rosterConfirm) return;
        if (rosterConfirm.action === "hide") {
            handleConfirmRemoveConsultant(rosterConfirm.resourceId);
        } else {
            handleConfirmReinstateConsultant(rosterConfirm.resourceId);
        }
        setRosterConfirm(null);
    };

    return (
        <>
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Consultant Utilization
                    </h2>
                    <div className="flex items-center rounded-md border border-border/70 overflow-hidden bg-surface/20">
                        <button
                            onClick={handlePrevWeek}
                            disabled={isWeekNavLocked}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-r border-border/70"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="px-3 py-1.5 min-w-[190px]">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">Week W{weekNumber}</div>
                            <div className="text-xs font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={handleNextWeek}
                            disabled={isWeekNavLocked}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-l border-border/70"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <button
                        onClick={handleCurrentWeek}
                        disabled={isWeekNavLocked}
                        className={cn(
                            "h-9 px-3 rounded-md border border-border/70 text-xs font-semibold transition-colors",
                            isCurrentWeek ? "text-white bg-surface/50" : "text-text-muted hover:text-white hover:bg-surface-hover"
                        )}
                    >
                        Current Week
                    </button>
                    <span className="text-xs text-text-muted">{weekLabel}</span>
                </div>
                <span className="text-[11px] text-text-muted">{isPending ? "Saving..." : "Synced with capacity grid allocations"}</span>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-sm font-semibold text-text-main">CONSULTANT UTILIZATION</h3>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-border/70 bg-surface/20 p-1">
                        <button
                            type="button"
                            onClick={() => setActiveRosterTab("active")}
                            className={cn(
                                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                                activeRosterTab === "active" ? "bg-surface-hover text-white" : "text-text-muted hover:text-white"
                            )}
                        >
                            Active ({activeConsultants.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveRosterTab("removed")}
                            className={cn(
                                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                                activeRosterTab === "removed" ? "bg-surface-hover text-white" : "text-text-muted hover:text-white"
                            )}
                        >
                            Removed ({removedConsultants.length})
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto text-[13px]">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-surface/10">
                                <th className="px-5 py-2.5 font-medium min-w-[180px]">Consultant</th>
                                <th className="px-5 py-2.5 font-medium w-24 border-l border-border/30">Max Capacity</th>
                                <th className="px-5 py-2.5 font-medium w-36 border-l border-border/30 text-amber-500/80">Billable Capacity</th>
                                <th className="px-5 py-2.5 font-medium w-24 bg-indigo-500/5 text-white font-bold">Hours</th>
                                <th className="px-5 py-2.5 font-medium w-24">Util %</th>
                                <th className="px-5 py-2.5 font-medium w-28 text-right">Available Hrs</th>
                                <th className="px-5 py-2.5 font-medium min-w-[220px] border-l border-border/30">Notes</th>
                                <th className="px-5 py-2.5 font-medium w-20 text-center border-l border-border/30">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {consultantsForCurrentTab.map((consultant) => {
                                const cfg = consultantConfigsById[consultant.id] || { maxCapacity: 40, billableCapacity: 40, notes: "" };
                                const hours =
                                    capacityHoursByConsultant.byId.get(consultant.id) ||
                                    capacityHoursByConsultant.byName.get(normalizeName(consultant.name)) ||
                                    0;
                                const total = Number(hours || 0);
                                const util = Number(cfg.billableCapacity || 0) > 0 ? (total / Number(cfg.billableCapacity || 0)) * 100 : 0;
                                const available = Math.max(0, Number(cfg.billableCapacity || 0) - total);

                                return (
                                    <tr key={consultant.id} className="hover:bg-surface/30 transition-colors">
                                        <td className="px-5 py-2 font-medium text-text-main">{consultant.name}</td>
                                        <td className="px-5 py-2 border-l border-border/30">
                                            <input
                                                type="number"
                                                disabled={isPastWeek}
                                                value={cfg.maxCapacity ?? 40}
                                                onChange={(e) => onConsultantConfigChange?.(consultant.id, { maxCapacity: Number(e.target.value) })}
                                                onBlur={(e) => persistConsultant(consultant.id, { maxCapacity: Number(e.target.value) })}
                                                className="w-16 bg-surface border border-border rounded px-2 py-1 focus:border-indigo-500 outline-none transition-colors text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                                            />
                                        </td>
                                        <td className="px-5 py-2 text-amber-400 font-medium bg-amber-500/5 border-l border-border/30">
                                            <input
                                                type="number"
                                                disabled={isPastWeek}
                                                value={cfg.billableCapacity ?? 40}
                                                onChange={(e) => onConsultantConfigChange?.(consultant.id, { billableCapacity: Number(e.target.value) })}
                                                onBlur={(e) => persistConsultant(consultant.id, { billableCapacity: Number(e.target.value) })}
                                                className="w-20 bg-transparent border border-amber-500/30 rounded px-2 py-1 focus:border-amber-500 outline-none transition-colors text-amber-400 font-medium disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                                            />
                                        </td>
                                        <td className="px-5 py-2 bg-indigo-500/5 font-semibold text-white text-right">{total.toFixed(1)}</td>
                                        <td className={cn("px-5 py-2 text-right", util > 100 ? "text-red-400 font-bold" : "text-text-muted")}>{util.toFixed(0)}%</td>
                                        <td className="px-5 py-2 text-right text-text-muted">{available.toFixed(1)}</td>
                                        <td className="px-5 py-2 border-l border-border/30">
                                            <input
                                                type="text"
                                                disabled={isPastWeek}
                                                value={cfg.notes || ""}
                                                onChange={(e) => onConsultantConfigChange?.(consultant.id, { notes: e.target.value })}
                                                onBlur={(e) => persistConsultant(consultant.id, { notes: e.target.value })}
                                                placeholder="..."
                                                className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-indigo-500 outline-none transition-colors py-0.5 disabled:opacity-50 disabled:cursor-not-allowed text-xs text-text-muted"
                                            />
                                        </td>
                                        <td className="px-5 py-2 border-l border-border/30 text-center">
                                            {activeRosterTab === "active" ? (
                                                <button
                                                    type="button"
                                                    disabled={isPastWeek}
                                                    onClick={() => handleRemoveConsultant(consultant.resourceId, consultant.name)}
                                                    className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 text-text-muted hover:text-red-300 hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    aria-label={`Remove ${consultant.name}`}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={isPastWeek}
                                                    onClick={() => handleReinstateConsultant(consultant.resourceId, consultant.name)}
                                                    className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 text-text-muted hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    aria-label={`Reinstate ${consultant.name}`}
                                                >
                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {consultantsForCurrentTab.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-5 py-6 text-center text-xs text-text-muted">
                                        {activeRosterTab === "active"
                                            ? "No active consultants in this week's saved roster."
                                            : "No removed consultants for this week."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="bg-indigo-500/10 font-bold border-t border-border/50">
                            <tr>
                                <td className="px-5 py-2.5 text-text-main text-[12px] uppercase tracking-wider">TOTAL</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] border-l border-border/30">{totalsRow.max.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-amber-500/80 text-[13px] border-l border-border/30">{totalsRow.billable.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-white text-[13px] text-right">{totalsRow.total.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{utilizationPct.toFixed(0)}%</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{totalsRow.available.toFixed(1)}</td>
                                <td className="px-5 py-2.5 border-l border-border/30"></td>
                                <td className="px-5 py-2.5 border-l border-border/30"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </section>
        {rosterConfirm && (
            <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                    <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                        <div>
                            <div className="text-sm font-semibold text-text-main">
                                {rosterConfirm.action === "hide" ? "Hide Consultant" : "Reinstate Consultant"}
                            </div>
                            <div className="mt-1 text-xs text-text-muted">
                                {rosterConfirm.action === "hide"
                                    ? <>This will hide <span className="font-medium text-white">{rosterConfirm.consultantName}</span> from this week&apos;s roster and capacity views.</>
                                    : <>This will restore <span className="font-medium text-white">{rosterConfirm.consultantName}</span> to this week&apos;s roster and capacity views.</>}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setRosterConfirm(null)}
                            className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            aria-label="Close confirmation"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="px-5 py-4 text-sm text-text-muted">
                        {rosterConfirm.action === "hide"
                            ? "The consultant will remain hidden until you choose to reinstate them from the Removed tab."
                            : "The consultant will return to the Active tab and appear again across the planning screens."}
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => setRosterConfirm(null)}
                            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirmRosterAction}
                            className={cn(
                                "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                                rosterConfirm.action === "hide"
                                    ? "border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                                    : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                            )}
                        >
                            {rosterConfirm.action === "hide" ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                            {rosterConfirm.action === "hide" ? "Hide Consultant" : "Reinstate Consultant"}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
