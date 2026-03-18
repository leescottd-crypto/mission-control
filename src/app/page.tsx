import {
    getTeamTasks,
    getTeamTimeEntries,
    getSpaceFoldersWithLists,
    PROFESSIONAL_SERVICES_SPACE_ID
} from "@/lib/clickup";
import { DashboardClient } from "@/components/DashboardClient";
import { addDays, addWeeks, endOfYear, format, startOfWeek } from "date-fns";
import {
    getWeekConfig,
    getWeekConfigsForYear,
    getLeadConfigs,
    getClientConfigs,
    getConsultantConfigs,
    getCapacityGridConfig,
    getConsultantConfigsForYear,
    getCapacityGridConfigsForYear,
    getEditableTaskBillableRollups,
    getTaskSidebarStructure
} from "@/app/actions";

export const dynamic = "force-dynamic";

const CANONICAL_2026_WEEK_DATA: Record<string, { totalHours: number; vsTarget: number; vsStretch: number }> = {
    W02: { totalHours: 235.3, vsTarget: -114.8, vsStretch: -164.8 },
    W03: { totalHours: 230.0, vsTarget: -120.0, vsStretch: -170.0 },
    W04: { totalHours: 266.5, vsTarget: -83.5, vsStretch: -133.5 },
    W05: { totalHours: 321.1, vsTarget: -28.9, vsStretch: -78.9 },
    W06: { totalHours: 282.0, vsTarget: -68.0, vsStretch: -118.0 },
    W07: { totalHours: 321.0, vsTarget: -29.0, vsStretch: -79.0 },
    W08: { totalHours: 298.3, vsTarget: -51.8, vsStretch: -101.8 },
    W09: { totalHours: 314.8, vsTarget: -35.3, vsStretch: -85.3 },
    W10: { totalHours: 380.5, vsTarget: 30.5, vsStretch: -19.5 },
    W11: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
    W12: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
    W13: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
    W14: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
};

export default async function DashboardPage({ searchParams }: { searchParams: { week?: string; tab?: string; listId?: string; folderId?: string; assignee?: string } }) {
    // Await searchParams for Next.js 15 compatibility, but fallback safely
    const sp = await Promise.resolve(searchParams);

    // Current week Monday to Sunday
    let referenceDate = new Date();
    if (sp?.week) {
        // e.g. "2024-10-21"
        const parsed = new Date(sp.week + 'T00:00:00');
        if (!isNaN(parsed.getTime())) {
            referenceDate = parsed;
        }
    }

    const startMs = startOfWeek(referenceDate, { weekStartsOn: 1 }).getTime();
    const endMs = addDays(new Date(startMs), 6).getTime();

    const weekStartStr = format(startMs, 'yyyy-MM-dd');
    const initialTab = String(sp?.tab || "");
    const initialSelectedListId = typeof sp?.listId === "string" && sp.listId.trim().length > 0 ? sp.listId.trim() : null;
    const initialSelectedFolderId = initialSelectedListId
        ? null
        : typeof sp?.folderId === "string" && sp.folderId.trim().length > 0
            ? sp.folderId.trim()
            : null;
    const initialAssigneeFilter = typeof sp?.assignee === "string" && sp.assignee.trim().length > 0 ? sp.assignee.trim() : null;
    const previousWeekStartStr = format(addWeeks(new Date(startMs), -1), "yyyy-MM-dd");
    const activeYear = new Date(startMs).getFullYear();
    const yearStartMs = new Date(activeYear, 0, 1).getTime();
    const yearEndMs = endOfYear(new Date(activeYear, 0, 1)).getTime();

    const EXCLUDED_FOLDERS = [
        "90175039771", // PS Look Up Tables
        "90174957796" // Monthly Budgets
    ];

    // Fetch in parallel
    const [
        initialTasks,
        initialFolders,
        yearTimeEntries,
        weekConfig,
        weekConfigsForYear,
        leadConfigs,
        clientConfigs,
        consultantConfigs,
        consultantConfigsForYear,
        capacityGridConfigsForYear,
        previousLeadConfigs,
        previousClientConfigs,
        previousConsultantConfigs,
        initialTaskBillableRollups,
        initialSidebarStructure
    ] = await Promise.all([
        getTeamTasks(),
        getSpaceFoldersWithLists(PROFESSIONAL_SERVICES_SPACE_ID, EXCLUDED_FOLDERS),
        getTeamTimeEntries(yearStartMs, yearEndMs),
        getWeekConfig(weekStartStr),
        getWeekConfigsForYear(activeYear),
        getLeadConfigs(weekStartStr),
        getClientConfigs(weekStartStr),
        getConsultantConfigs(weekStartStr),
        getConsultantConfigsForYear(activeYear),
        getCapacityGridConfigsForYear(activeYear),
        getLeadConfigs(previousWeekStartStr),
        getClientConfigs(previousWeekStartStr),
        getConsultantConfigs(previousWeekStartStr),
        getEditableTaskBillableRollups(weekStartStr),
        getTaskSidebarStructure(),
    ]);

    const isError = !Array.isArray(initialTasks) && (initialTasks as any).error;
    const validTasks = isError ? [] : initialTasks;
    const consultantNameById = new Map<number, string>();
    validTasks
        .filter((task: any) => task.space?.id === PROFESSIONAL_SERVICES_SPACE_ID)
        .forEach((task: any) => {
            if (!Array.isArray(task.assignees)) return;
            task.assignees.forEach((a: any) => {
                const id = Number(a?.id ?? 0);
                const nextName = String(a?.username ?? "").trim();
                if (!id || !nextName) return;
                const existing = consultantNameById.get(id);
                if (!existing) {
                    consultantNameById.set(id, nextName);
                    return;
                }
                const existingTokens = existing.split(/\s+/).filter(Boolean).length;
                const nextTokens = nextName.split(/\s+/).filter(Boolean).length;
                if (nextTokens > existingTokens || (nextTokens === existingTokens && nextName.length > existing.length)) {
                    consultantNameById.set(id, nextName);
                }
            });
        });

    const consultantRoster = Array.from(consultantNameById.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const capacityGridConfig = await getCapacityGridConfig(weekStartStr, consultantRoster);
    const validYearTimeEntries = Array.isArray(yearTimeEntries) ? yearTimeEntries : [];
    const weekConfigByStart = new Map<string, { baseTarget: number, stretchTarget: number }>();
    weekConfigsForYear.forEach((cfg: any) => {
        weekConfigByStart.set(cfg.week, {
            baseTarget: Number(cfg.baseTarget ?? 350),
            stretchTarget: Number(cfg.stretchTarget ?? 400)
        });
    });

    const timeByWeekStart = new Map<string, number>();
    validYearTimeEntries.forEach((entry: any) => {
        const entryStart = Number(entry?.start || 0);
        if (!entryStart) return;
        const wk = startOfWeek(new Date(entryStart), { weekStartsOn: 1 });
        const key = format(wk, "yyyy-MM-dd");
        const hrs = (Number(entry.duration) || 0) / (1000 * 60 * 60);
        timeByWeekStart.set(key, (timeByWeekStart.get(key) || 0) + hrs);
    });

    const getFirstMonday = (year: number) => {
        const d = new Date(year, 0, 1);
        while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
        return d;
    };

    const weeklyTrend: Array<{
        weekStart: string;
        weekLabel: string;
        periodLabel: string;
        totalHours: number;
        baseTarget: number;
        stretchTarget: number;
        vsTarget?: number;
        vsStretch?: number;
    }> = [];

    let cursor = getFirstMonday(activeYear);
    const yearEnd = endOfYear(new Date(activeYear, 0, 1));
    while (cursor <= yearEnd) {
        const weekStartKey = format(cursor, "yyyy-MM-dd");
        const baseTargetForWeek = weekConfigByStart.get(weekStartKey)?.baseTarget ?? 350;
        const stretchTargetForWeek = weekConfigByStart.get(weekStartKey)?.stretchTarget ?? 400;
        const weekLabel = `W${format(cursor, "II")}`;
        const canonicalData = activeYear === 2026 ? CANONICAL_2026_WEEK_DATA[weekLabel] : undefined;
        weeklyTrend.push({
            weekStart: weekStartKey,
            weekLabel,
            periodLabel: `${format(cursor, "MM/dd")} to ${format(addDays(cursor, 4), "MM/dd")}`,
            totalHours: Number((canonicalData?.totalHours ?? (timeByWeekStart.get(weekStartKey) || 0)).toFixed(1)),
            baseTarget: Number(baseTargetForWeek.toFixed(1)),
            stretchTarget: Number(stretchTargetForWeek.toFixed(1)),
            vsTarget: canonicalData?.vsTarget,
            vsStretch: canonicalData?.vsStretch,
        });
        cursor = addWeeks(cursor, 1);
    }

    // Fallback logic for Client and Consultant capacities using seeded W10 (2026-03-02) base
    const BASE_CONFIG_WEEK = "2026-03-02";

    const mergeClientConfigs = (baseRows: any[], weekRows: any[]) => {
        const baseById = new Map<string, any>();
        baseRows.forEach((row: any) => {
            baseById.set(String(row.clientId), row);
        });

        const weekById = new Map<string, any>();
        weekRows.forEach((row: any) => {
            weekById.set(String(row.clientId), row);
        });

        const merged: any[] = [];
        baseById.forEach((baseRow, clientId) => {
            const weekRow = weekById.get(clientId);
            merged.push({
                ...baseRow,
                ...(weekRow || {}),
                clientId,
                // Keep base order unless week explicitly overrides with a meaningful value.
                orderIndex: weekRow?.orderIndex ?? baseRow.orderIndex ?? 0,
                clientName: weekRow?.clientName || baseRow.clientName || clientId,
            });
            weekById.delete(clientId);
        });

        // Include any week-only rows not in the base template.
        weekById.forEach((row) => {
            merged.push({
                ...row,
                clientId: String(row.clientId),
                clientName: row.clientName || String(row.clientId),
                orderIndex: row.orderIndex ?? 9999,
            });
        });

        return merged.sort((a, b) => {
            const ao = Number(a.orderIndex ?? 9999);
            const bo = Number(b.orderIndex ?? 9999);
            if (ao !== bo) return ao - bo;
            return String(a.clientName || a.clientId).localeCompare(String(b.clientName || b.clientId));
        });
    };

    const baseClientConfigs = await getClientConfigs(BASE_CONFIG_WEEK);
    let finalClientConfigs = mergeClientConfigs(baseClientConfigs, clientConfigs);

    if (clientConfigs.length > 0 && clientConfigs.length < baseClientConfigs.length) {
        console.log(
            `[DashboardPage] partial clientConfigs for ${weekStartStr}: ${clientConfigs.length}/${baseClientConfigs.length}; merged with base template`
        );
    }

    let finalConsultantConfigs = consultantConfigs;

    if (finalConsultantConfigs.length === 0) {
        finalConsultantConfigs = await getConsultantConfigs(BASE_CONFIG_WEEK);
    }

    console.log(`[DashboardPage] weekStartStr=${weekStartStr}`);
    console.log(`[DashboardPage] clientConfigs loaded from DB: ${finalClientConfigs.length}`);

    return (
        <DashboardClient
            initialTasks={validTasks}
            initialFolders={initialFolders}
            initialTimeEntries={validYearTimeEntries}
            isError={isError}
            weekStartStr={weekStartStr}
            initialTab={initialTab}
            initialSelectedListId={initialSelectedListId}
            initialSelectedFolderId={initialSelectedFolderId}
            initialAssigneeFilter={initialAssigneeFilter}
            initialTaskBillableRollups={initialTaskBillableRollups}
            initialSidebarStructure={initialSidebarStructure}
            dbConfig={{
                weekConfig,
                weeklyTrend,
                leadConfigs,
                clientConfigs: finalClientConfigs,
                consultantConfigs: finalConsultantConfigs,
                capacityGridConfig,
                consultantConfigsForYear,
                capacityGridConfigsForYear,
                previousWeekStartStr,
                previousLeadConfigs,
                previousClientConfigs,
                previousConsultantConfigs,
            }}
        />
    );
}
