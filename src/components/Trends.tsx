"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrendsProps {
    activeWeekStr: string;
    weeklyTrend: Array<{
        weekStart: string;
        weekLabel: string;
        periodLabel: string;
        totalHours: number;
        baseTarget?: number;
        stretchTarget?: number;
        vsTarget?: number;
        vsStretch?: number;
    }>;
    onNavigateWeek?: (nextWeek: string) => void;
    isWeekLoading?: boolean;
}

function formatSigned(value: number) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function Trends({ activeWeekStr, weeklyTrend, onNavigateWeek, isWeekLoading = false }: TrendsProps) {
    const router = useRouter();
    const activeWeekDate = new Date(activeWeekStr + "T00:00:00");
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const currentWeekKey = format(currentWeekStart, "yyyy-MM-dd");
    const includeCurrentWeek = new Date().getDay() >= 3; // Wed (3) onward
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const isNavigationBlocked = !onNavigateWeek && isWeekLoading;
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=trends`;
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
        router.push("/?tab=trends");
    };

    const rowsForDisplay = useMemo(() => {
        const activeYear = Number(activeWeekStr.slice(0, 4));
        const shouldIncludeRow = (weekStart: string) => includeCurrentWeek || weekStart !== currentWeekKey;
        if (activeYear === 2026) {
            return weeklyTrend.filter((row) => {
                const n = Number(String(row.weekLabel || "").replace("W", ""));
                return n >= 2 && n <= 14 && shouldIncludeRow(String(row.weekStart || ""));
            });
        }
        const cutoff = addWeeks(currentWeekStart, 4).getTime();
        return weeklyTrend.filter((row) => {
            const weekStart = String(row.weekStart || "");
            return new Date(weekStart + "T00:00:00").getTime() <= cutoff && shouldIncludeRow(weekStart);
        });
    }, [weeklyTrend, currentWeekStart, activeWeekStr, includeCurrentWeek, currentWeekKey]);

    const ytdRows = useMemo(() => {
        const nowWeek = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
        return weeklyTrend.filter((row) => new Date(row.weekStart + "T00:00:00").getTime() <= nowWeek && Number(row.totalHours || 0) > 0);
    }, [weeklyTrend]);

    const ytdAvgTotal = ytdRows.length > 0
        ? ytdRows.reduce((sum, row) => sum + Number(row.totalHours || 0), 0) / ytdRows.length
        : 0;
    const ytdAvgTarget = ytdRows.length > 0
        ? ytdRows.reduce((sum, row) => sum + Number(row.baseTarget || 350), 0) / ytdRows.length
        : 350;
    const ytdAvgStretch = ytdRows.length > 0
        ? ytdRows.reduce((sum, row) => sum + Number(row.stretchTarget || 400), 0) / ytdRows.length
        : 400;

    const chartRows = useMemo(() => {
        const nowWeek = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
        const chartCutoff = includeCurrentWeek ? nowWeek : subWeeks(currentWeekStart, 1).getTime();
        return rowsForDisplay.filter((row) => new Date(row.weekStart + "T00:00:00").getTime() <= chartCutoff);
    }, [rowsForDisplay, includeCurrentWeek, currentWeekStart]);

    const chartSeries = chartRows.map((row) => ({
        weekStart: row.weekStart,
        label: row.weekLabel,
        period: row.periodLabel,
        value: Number(row.totalHours || 0),
    }));
    const chartWidth = Math.max(820, chartSeries.length * 72);
    const chartHeight = 280;
    const padding = { top: 16, right: 20, bottom: 56, left: 52 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;
    const maxValue = Math.max(...chartSeries.map((p) => p.value), 1);
    const yMax = Math.ceil(maxValue / 25) * 25 || 25;

    const getX = (idx: number) => {
        if (chartSeries.length <= 1) return padding.left + innerWidth / 2;
        return padding.left + (idx / (chartSeries.length - 1)) * innerWidth;
    };
    const getY = (value: number) => padding.top + (1 - value / yMax) * innerHeight;
    const polylinePoints = chartSeries.map((p, idx) => `${getX(idx)},${getY(p.value)}`).join(" ");

    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Billing Trends
                    </h2>
                    <div className="flex items-center rounded-md border border-border/70 overflow-hidden bg-surface/20">
                        <button
                            onClick={handlePrevWeek}
                            disabled={isNavigationBlocked}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-r border-border/70 disabled:opacity-50"
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
                            disabled={isNavigationBlocked}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-l border-border/70 disabled:opacity-50"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <button
                        onClick={handleCurrentWeek}
                        disabled={isNavigationBlocked}
                        className={cn(
                            "h-9 px-3 rounded-md border border-border/70 text-xs font-semibold transition-colors disabled:opacity-50",
                            isCurrentWeek ? "text-white bg-surface/50" : "text-text-muted hover:text-white hover:bg-surface-hover"
                        )}
                    >
                        Current Week
                    </button>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-text-main">BILLED HOURS TREND (WEEK-OVER-WEEK)</h3>
                </div>
                <div className="p-4 overflow-x-auto">
                    <svg width={chartWidth} height={chartHeight} role="img" aria-label="Week-over-week billed hours trend">
                        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                            const y = padding.top + t * innerHeight;
                            const value = ((1 - t) * yMax).toFixed(0);
                            return (
                                <g key={`grid-${i}`}>
                                    <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="rgba(148,163,184,0.25)" strokeDasharray="3 3" />
                                    <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
                                        {value}
                                    </text>
                                </g>
                            );
                        })}

                        <polyline fill="none" stroke="#60a5fa" strokeWidth="2.5" points={polylinePoints} />

                        {chartSeries.map((p, idx) => {
                            const x = getX(idx);
                            const y = getY(p.value);
                            const isActive = p.weekStart === activeWeekStr;
                            return (
                                <g key={p.weekStart}>
                                    <circle cx={x} cy={y} r={isActive ? 4.5 : 3.5} fill={isActive ? "#22d3ee" : "#93c5fd"} />
                                    <text x={x} y={chartHeight - 24} textAnchor="middle" fill={isActive ? "#ffffff" : "#94a3b8"} fontSize="10">
                                        {p.label}
                                    </text>
                                    <text x={x} y={chartHeight - 10} textAnchor="middle" fill="#64748b" fontSize="9">
                                        {p.period}
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
                    <h3 className="text-sm font-semibold text-text-main">WEEK-OVER-WEEK TREND TABLE</h3>
                    <span className="text-xs text-text-muted">Raw billed hours data</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-surface/10">
                                <th className="px-4 py-2">Week</th>
                                <th className="px-4 py-2">Period</th>
                                <th className="px-4 py-2 text-right">Total Hours</th>
                                <th className="px-4 py-2 text-right">vs Target</th>
                                <th className="px-4 py-2 text-right">vs Stretch</th>
                                <th className="px-4 py-2">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {rowsForDisplay.map((row) => {
                                const vsTarget = row.vsTarget !== undefined
                                    ? Number(row.vsTarget)
                                    : Number(row.totalHours || 0) - Number(row.baseTarget || 350);
                                const vsStretch = row.vsStretch !== undefined
                                    ? Number(row.vsStretch)
                                    : Number(row.totalHours || 0) - Number(row.stretchTarget || 400);
                                const rowDate = new Date(row.weekStart + "T00:00:00");
                                const isFutureRow = rowDate.getTime() > currentWeekStart.getTime();
                                const statusText = isFutureRow
                                    ? "(In progress)"
                                    : vsTarget >= 0
                                        ? "Target hit"
                                        : "Below target";

                                return (
                                    <tr key={row.weekStart} className={cn("hover:bg-surface/30", row.weekStart === activeWeekStr ? "bg-indigo-500/10" : "")}>
                                        <td className="px-4 py-2 font-semibold text-white">{row.weekLabel}</td>
                                        <td className="px-4 py-2 text-text-muted">{row.periodLabel}</td>
                                        <td className="px-4 py-2 text-right tabular-nums text-white">{Number(row.totalHours || 0).toFixed(1)}</td>
                                        <td className={cn("px-4 py-2 text-right tabular-nums", vsTarget >= 0 ? "text-green-400" : "text-amber-400")}>{formatSigned(vsTarget)}</td>
                                        <td className={cn("px-4 py-2 text-right tabular-nums", vsStretch >= 0 ? "text-green-400" : "text-amber-400")}>{formatSigned(vsStretch)}</td>
                                        <td className={cn("px-4 py-2", isFutureRow ? "text-text-muted" : vsTarget >= 0 ? "text-green-400" : "text-amber-400")}>
                                            {isFutureRow ? "" : vsTarget >= 0 ? "✅ " : "⚠️ "}{statusText}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-indigo-500/10 font-bold border-t border-border/50">
                            <tr>
                                <td className="px-4 py-2.5 text-white italic">YTD Average</td>
                                <td className="px-4 py-2.5 text-text-muted"></td>
                                <td className="px-4 py-2.5 text-right text-white tabular-nums">{ytdAvgTotal.toFixed(1)}</td>
                                <td className={cn("px-4 py-2.5 text-right tabular-nums", ytdAvgTotal - ytdAvgTarget >= 0 ? "text-green-400" : "text-amber-400")}>
                                    {formatSigned(ytdAvgTotal - ytdAvgTarget)}
                                </td>
                                <td className={cn("px-4 py-2.5 text-right tabular-nums", ytdAvgTotal - ytdAvgStretch >= 0 ? "text-green-400" : "text-amber-400")}>
                                    {formatSigned(ytdAvgTotal - ytdAvgStretch)}
                                </td>
                                <td className="px-4 py-2.5 text-text-muted">{ytdRows.length} weeks</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </section>
    );
}
