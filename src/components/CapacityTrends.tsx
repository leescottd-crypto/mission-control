"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { Activity, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CapacityGridPayload, CapacityGridWeekRecord } from "@/app/actions";

interface CapacityTrendsProps {
    activeWeekStr: string;
    consultants: Array<{ id: number; name: string }>;
    consultantConfigsForYear: Array<{ week: string; consultantId: number; billableCapacity?: number | null }>;
    consultantConfigsCurrentWeek?: Array<{ consultantId: number; billableCapacity?: number | null }>;
    capacityGridConfigsForYear: CapacityGridWeekRecord[];
}

function normalizeName(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getAllocationHours(cell: unknown) {
    const legacyCell = cell as { hours?: number; wt?: number; wPlus?: number } | undefined;
    return Number(legacyCell?.hours ?? Number(legacyCell?.wt ?? 0) + Number(legacyCell?.wPlus ?? 0));
}

function getFirstMonday(year: number) {
    const d = new Date(year, 0, 1);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    return d;
}

function formatSigned(value: number) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function CapacityTrends({
    activeWeekStr,
    consultants,
    consultantConfigsForYear,
    consultantConfigsCurrentWeek = [],
    capacityGridConfigsForYear,
}: CapacityTrendsProps) {
    const router = useRouter();
    const [isWeekNavLocked, setIsWeekNavLocked] = useState(false);
    const navUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeWeekDate = new Date(activeWeekStr + "T00:00:00");
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=capacity-trends`;
    const navigateToWeek = (nextDate: Date | null) => {
        if (isWeekNavLocked) return;
        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (nextDate === null && activeWeekStr === currentWeekStr) return;
        if (nextDate && format(nextDate, "yyyy-MM-dd") === activeWeekStr) return;

        const href = nextDate ? weekParamFor(nextDate) : "/?tab=capacity-trends";
        setIsWeekNavLocked(true);
        router.push(href);
        navUnlockTimerRef.current = setTimeout(() => {
            setIsWeekNavLocked(false);
            navUnlockTimerRef.current = null;
        }, 500);
    };
    const handlePrevWeek = () => navigateToWeek(subWeeks(activeWeekDate, 1));
    const handleNextWeek = () => navigateToWeek(addWeeks(activeWeekDate, 1));
    const handleCurrentWeek = () => navigateToWeek(null);

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

    const weeks = useMemo(() => {
        const activeYear = Number(activeWeekStr.slice(0, 4));
        const entries = (Array.isArray(capacityGridConfigsForYear) ? capacityGridConfigsForYear : [])
            .map((row) => String(row.week || ""))
            .filter((week) => week.startsWith(`${activeYear}-`) && week <= activeWeekStr)
            .sort();
        const startDate = entries.length > 0
            ? new Date(entries[0] + "T00:00:00")
            : getFirstMonday(activeYear);

        const result: string[] = [];
        let cursor = startOfWeek(startDate, { weekStartsOn: 1 });
        const end = startOfWeek(new Date(activeWeekStr + "T00:00:00"), { weekStartsOn: 1 });
        while (cursor <= end) {
            result.push(format(cursor, "yyyy-MM-dd"));
            cursor = addWeeks(cursor, 1);
        }
        return result;
    }, [activeWeekStr, capacityGridConfigsForYear]);

    const consultantsForGrid = useMemo(() => {
        const byId = new Map<number, { key: string; id: number; name: string }>();
        consultants.forEach((c) => {
            if (Boolean((c as any)?.removed)) return;
            const id = Number(c.id || 0);
            if (id <= 0) return;
            const name = String(c.name || "").trim() || `Consultant ${id}`;
            const existing = byId.get(id);
            if (!existing || name.length > existing.name.length) {
                byId.set(id, { key: `id:${id}`, id, name });
            }
        });

        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [consultants]);

    const weeklyHoursByConsultant = useMemo(() => {
        const map = new Map<string, { byId: Map<number, number>; byName: Map<string, number> }>();

        (Array.isArray(capacityGridConfigsForYear) ? capacityGridConfigsForYear : []).forEach((weekRow) => {
            const week = String(weekRow.week || "");
            if (!weeks.includes(week)) return;
            const payload = weekRow.payload as CapacityGridPayload;
            const resources = (Array.isArray(payload?.resources) ? payload.resources : []).filter((resource: any) => !Boolean(resource?.removed));
            const rows = Array.isArray(payload?.rows) ? payload.rows : [];

            const byId = new Map<number, number>();
            const byName = new Map<string, number>();

            rows.forEach((row) => {
                const allocations = row?.allocations || {};
                resources.forEach((resource) => {
                    const hours = getAllocationHours(allocations?.[resource.id]);
                    const consultantId = Number(resource?.consultantId ?? 0);
                    if (consultantId > 0) {
                        byId.set(consultantId, Number(byId.get(consultantId) ?? 0) + hours);
                    }
                    const nameKey = normalizeName(String(resource?.name || ""));
                    if (nameKey) {
                        byName.set(nameKey, Number(byName.get(nameKey) ?? 0) + hours);
                    }
                });
            });

            map.set(week, { byId, byName });
        });

        return map;
    }, [capacityGridConfigsForYear, weeks]);

    const capacityByWeekAndConsultant = useMemo(() => {
        const map = new Map<string, number>();

        (Array.isArray(consultantConfigsForYear) ? consultantConfigsForYear : []).forEach((cfg) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            const key = `id:${consultantId}`;
            const billable = Number(cfg?.billableCapacity ?? 40);
            const week = String(cfg?.week || "");
            if (week) map.set(`${week}|${key}`, billable);
        });

        (Array.isArray(consultantConfigsCurrentWeek) ? consultantConfigsCurrentWeek : []).forEach((cfg) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            const key = `id:${consultantId}`;
            map.set(`${activeWeekStr}|${key}`, Number(cfg?.billableCapacity ?? 40));
        });

        return map;
    }, [consultantConfigsForYear, consultantConfigsCurrentWeek, activeWeekStr]);

    const getUtilization = (week: string, consultant: { id: number; name: string; key: string }) => {
        const weekHours = weeklyHoursByConsultant.get(week);
        const hours =
            weekHours?.byId.get(consultant.id) ||
            weekHours?.byName.get(normalizeName(consultant.name)) ||
            0;
        const planned = Number(hours || 0);
        const capacity = Number(
            capacityByWeekAndConsultant.get(`${week}|${consultant.key}`)
            ?? 40
        );
        if (capacity <= 0) return 0;
        return (planned / capacity) * 100;
    };

    const cellClass = (utilization: number) => {
        if (utilization >= 80) return "bg-emerald-500/25 border-emerald-400/40 text-emerald-200";
        if (utilization >= 50) return "bg-yellow-500/20 border-yellow-400/40 text-yellow-100";
        return "bg-red-500/20 border-red-400/40 text-red-100";
    };

    const overallForActiveWeek = useMemo(() => {
        const totalPlanned = consultantsForGrid.reduce((sum, consultant) => {
            const weekHours = weeklyHoursByConsultant.get(activeWeekStr);
            const hours =
                weekHours?.byId.get(consultant.id) ||
                weekHours?.byName.get(normalizeName(consultant.name)) ||
                0;
            return sum + Number(hours || 0);
        }, 0);

        const totalBillable = consultantsForGrid.reduce((sum, consultant) => {
            const capacity = Number(
                capacityByWeekAndConsultant.get(`${activeWeekStr}|${consultant.key}`)
                ?? 40
            );
            return sum + Math.max(0, capacity);
        }, 0);

        const utilization = totalBillable > 0 ? (totalPlanned / totalBillable) * 100 : 0;
        return { totalPlanned, totalBillable, utilization };
    }, [activeWeekStr, consultantsForGrid, weeklyHoursByConsultant, capacityByWeekAndConsultant]);

    const utilizationTrendRows = useMemo(() => {
        return weeks.map((week) => {
            const weekDate = new Date(week + "T00:00:00");
            const weekLabel = `W${format(weekDate, "II")}`;
            const periodLabel = `${format(weekDate, "MM/dd")} to ${format(addDays(weekDate, 4), "MM/dd")}`;
            const weekHours = weeklyHoursByConsultant.get(week);

            const planned = consultantsForGrid.reduce((sum, consultant) => {
                const hours =
                    weekHours?.byId.get(consultant.id) ||
                    weekHours?.byName.get(normalizeName(consultant.name)) ||
                    0;
                return sum + Number(hours || 0);
            }, 0);

            const billable = consultantsForGrid.reduce((sum, consultant) => {
                const capacity = Number(capacityByWeekAndConsultant.get(`${week}|${consultant.key}`) ?? 40);
                return sum + Math.max(0, capacity);
            }, 0);

            const utilization = billable > 0 ? (planned / billable) * 100 : 0;
            return {
                week,
                weekLabel,
                periodLabel,
                planned,
                billable,
                utilization,
                vsHealthy: utilization - 80,
                vsModerate: utilization - 50,
            };
        });
    }, [weeks, consultantsForGrid, weeklyHoursByConsultant, capacityByWeekAndConsultant]);

    const chartRows = useMemo(() => {
        const nowWeek = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
        return utilizationTrendRows.filter((row) => new Date(row.week + "T00:00:00").getTime() <= nowWeek);
    }, [utilizationTrendRows]);

    const chartWidth = Math.max(820, chartRows.length * 72);
    const chartHeight = 280;
    const padding = { top: 16, right: 20, bottom: 56, left: 52 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;
    const maxValue = Math.max(...chartRows.map((p) => p.utilization), 1);
    const yMax = Math.max(100, Math.ceil(maxValue / 10) * 10);

    const getX = (idx: number) => {
        if (chartRows.length <= 1) return padding.left + innerWidth / 2;
        return padding.left + (idx / (chartRows.length - 1)) * innerWidth;
    };
    const getY = (value: number) => padding.top + (1 - value / yMax) * innerHeight;
    const polylinePoints = chartRows.map((p, idx) => `${getX(idx)},${getY(p.utilization)}`).join(" ");

    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Capacity Trends
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
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-text-main">OVERALL UTILIZATION</h3>
                    <span className="text-xs text-text-muted">Combined across all consultants</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4">
                    <div className="border border-border/40 rounded-lg bg-surface/20 p-3">
                        <div className="text-[11px] uppercase text-text-muted">Utilization %</div>
                        <div className={cn(
                            "text-3xl font-bold mt-1",
                            overallForActiveWeek.utilization >= 80
                                ? "text-emerald-300"
                                : overallForActiveWeek.utilization >= 50
                                    ? "text-yellow-200"
                                    : "text-red-300"
                        )}>
                            {overallForActiveWeek.utilization.toFixed(1)}%
                        </div>
                    </div>
                    <div className="border border-border/40 rounded-lg bg-surface/20 p-3">
                        <div className="text-[11px] uppercase text-text-muted">Planned Hours</div>
                        <div className="text-2xl font-bold text-white mt-1">{overallForActiveWeek.totalPlanned.toFixed(1)}</div>
                    </div>
                    <div className="border border-border/40 rounded-lg bg-surface/20 p-3">
                        <div className="text-[11px] uppercase text-text-muted">Billable Capacity</div>
                        <div className="text-2xl font-bold text-cyan-200 mt-1">{overallForActiveWeek.totalBillable.toFixed(1)}</div>
                    </div>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-text-main">UTILIZATION % TREND (WEEK-OVER-WEEK)</h3>
                </div>
                <div className="p-4 overflow-x-auto">
                    <svg width={chartWidth} height={chartHeight} role="img" aria-label="Week-over-week utilization trend">
                        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                            const y = padding.top + t * innerHeight;
                            const value = ((1 - t) * yMax).toFixed(0);
                            return (
                                <g key={`grid-${i}`}>
                                    <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="rgba(148,163,184,0.25)" strokeDasharray="3 3" />
                                    <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                                        {value}%
                                    </text>
                                </g>
                            );
                        })}

                        <polyline fill="none" stroke="#22d3ee" strokeWidth="2.5" points={polylinePoints} />

                        {chartRows.map((p, idx) => {
                            const x = getX(idx);
                            const y = getY(p.utilization);
                            const isActive = p.week === activeWeekStr;
                            return (
                                <g key={p.week}>
                                    <circle cx={x} cy={y} r={isActive ? 4.5 : 3.5} fill={isActive ? "#22d3ee" : "#67e8f9"} />
                                    <text x={x} y={chartHeight - 24} textAnchor="middle" fill={isActive ? "#ffffff" : "#94a3b8"} fontSize="10">
                                        {p.weekLabel}
                                    </text>
                                    <text x={x} y={chartHeight - 10} textAnchor="middle" fill="#64748b" fontSize="9">
                                        {p.periodLabel}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-text-main">UTILIZATION TREND TABLE</h3>
                    <span className="text-xs text-text-muted">Raw utilization data</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-surface/10">
                                <th className="px-4 py-2">Week</th>
                                <th className="px-4 py-2">Period</th>
                                <th className="px-4 py-2 text-right">Utilization %</th>
                                <th className="px-4 py-2 text-right">vs 80%</th>
                                <th className="px-4 py-2 text-right">vs 50%</th>
                                <th className="px-4 py-2 text-right">Planned Hrs</th>
                                <th className="px-4 py-2 text-right">Billable Capacity</th>
                                <th className="px-4 py-2">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {utilizationTrendRows.map((row) => {
                                const statusText = row.utilization >= 80
                                    ? "Healthy"
                                    : row.utilization >= 50
                                        ? "Moderate"
                                        : "Low";

                                return (
                                    <tr key={row.week} className={cn("hover:bg-surface/30", row.week === activeWeekStr ? "bg-indigo-500/10" : "")}>
                                        <td className="px-4 py-2 font-semibold text-white">{row.weekLabel}</td>
                                        <td className="px-4 py-2 text-text-muted">{row.periodLabel}</td>
                                        <td className={cn("px-4 py-2 text-right tabular-nums", row.utilization >= 80 ? "text-green-400" : row.utilization >= 50 ? "text-yellow-300" : "text-red-400")}>
                                            {row.utilization.toFixed(1)}%
                                        </td>
                                        <td className={cn("px-4 py-2 text-right tabular-nums", row.vsHealthy >= 0 ? "text-green-400" : "text-amber-400")}>
                                            {formatSigned(row.vsHealthy)}
                                        </td>
                                        <td className={cn("px-4 py-2 text-right tabular-nums", row.vsModerate >= 0 ? "text-green-400" : "text-amber-400")}>
                                            {formatSigned(row.vsModerate)}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums text-white">{row.planned.toFixed(1)}</td>
                                        <td className="px-4 py-2 text-right tabular-nums text-cyan-200">{row.billable.toFixed(1)}</td>
                                        <td className={cn("px-4 py-2", row.utilization >= 80 ? "text-green-400" : row.utilization >= 50 ? "text-yellow-300" : "text-red-400")}>
                                            {row.utilization >= 80 ? "✅ " : row.utilization >= 50 ? "⚠️ " : "🔴 "}
                                            {statusText}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-text-main">RESOURCE UTILIZATION BY WEEK</h3>
                    <span className="text-xs text-text-muted">Person-level under/over utilization</span>
                </div>

                <div className="px-5 py-3 border-b border-border/30 flex items-center gap-4 text-xs">
                    <span className="inline-flex items-center gap-1 text-emerald-300"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/60" />80%+</span>
                    <span className="inline-flex items-center gap-1 text-yellow-200"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-400/60" />50-79.9%</span>
                    <span className="inline-flex items-center gap-1 text-red-200"><span className="w-2.5 h-2.5 rounded-sm bg-red-400/60" />Under 50%</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-[1100px] w-full border-collapse text-[12px]">
                        <thead>
                            <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-surface/10">
                                <th className="px-4 py-2 text-left sticky left-0 bg-[#12131d] z-10 min-w-[220px]">Consultant</th>
                                {weeks.map((week) => (
                                    <th key={week} className="px-3 py-2 text-center min-w-[84px]">
                                        {`W${format(new Date(week + "T00:00:00"), "II")}`}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {consultantsForGrid.map((consultant) => (
                                <tr key={consultant.key} className="hover:bg-surface/20">
                                    <td className="px-4 py-2.5 text-white font-medium sticky left-0 bg-[#12131d] z-10">
                                        {consultant.name}
                                    </td>
                                    {weeks.map((week) => {
                                        const utilization = getUtilization(week, consultant);
                                        return (
                                            <td key={`${consultant.key}-${week}`} className="px-2 py-2">
                                                <div className={cn("rounded border text-center py-1.5 font-semibold tabular-nums", cellClass(utilization))}>
                                                    {utilization.toFixed(1)}%
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
