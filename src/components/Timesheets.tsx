"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
    addEditableTaskBillableEntry,
    CapacityGridPayload,
    EditableTaskBillableEntryRecord,
    EditableTaskRecord,
    EditableTaskSeed,
    getEditableTasks,
} from "@/app/actions";
import { ClickUpTask } from "@/lib/clickup";
import { cn } from "@/lib/utils";

interface TimesheetsProps {
    activeWeekStr: string;
    tasks: ClickUpTask[];
    consultants: Array<{ id: number; name: string }>;
    capacityGrid: CapacityGridPayload;
    initialAssigneeFilter?: string | null;
    onNavigateWeek?: (nextWeek: string) => void;
    onAssigneeFilterChange?: (assignee: string | null) => void;
    isWeekLoading?: boolean;
}

type BillableEntryDraft = {
    entryDate: string;
    hours: string;
    note: string;
    isValueAdd: boolean;
};

type TimesheetTaskRow = {
    task: EditableTaskRecord;
    clientLabel: string;
    plannedHours: number;
    billedHours: number;
    remainingHours: number;
    entries: EditableTaskBillableEntryRecord[];
};

function normalizeName(value: string) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function toValidDate(rawValue: string | number | null | undefined): Date | null {
    const raw = Number(rawValue ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toWeekStartStr(date: Date): string {
    return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function getTaskWeekStr(task: ClickUpTask, activeWeekStr: string): string {
    const activeWeekDate = new Date(`${activeWeekStr}T00:00:00`);
    const activeWeekEnd = addDays(activeWeekDate, 6);
    const startDate = toValidDate(task?.start_date);
    const dueDate = toValidDate(task?.due_date);
    const closedDate = toValidDate(task?.date_closed);
    const createdDate = toValidDate(task?.date_created);

    if (startDate && dueDate) {
        const rangeStart = startDate <= dueDate ? startDate : dueDate;
        const rangeEnd = startDate <= dueDate ? dueDate : startDate;
        if (rangeStart <= activeWeekEnd && rangeEnd >= activeWeekDate) {
            return activeWeekStr;
        }
    }

    if (startDate && toWeekStartStr(startDate) === activeWeekStr) return activeWeekStr;
    if (dueDate && toWeekStartStr(dueDate) === activeWeekStr) return activeWeekStr;
    if (closedDate && toWeekStartStr(closedDate) === activeWeekStr) return activeWeekStr;

    if (startDate) return toWeekStartStr(startDate);
    if (dueDate) return toWeekStartStr(dueDate);
    if (closedDate) return toWeekStartStr(closedDate);
    if (createdDate) return toWeekStartStr(createdDate);
    return "";
}

function normalizeEditableStatusFromClickUp(task: ClickUpTask): "backlog" | "open" | "closed" {
    const statusText = String(task?.status?.status ?? "").toLowerCase();
    const statusType = String(task?.status?.type ?? "").toLowerCase();
    if (statusType === "closed" || /(complete|completed|done|closed|resolved|shipped)/.test(statusText)) return "closed";
    if (/(backlog|not started|todo|to do|new|queued|queue|planned|plan|pending)/.test(statusText)) return "backlog";
    return "open";
}

function buildSeedTasks(tasks: ClickUpTask[], activeWeekStr: string): EditableTaskSeed[] {
    return tasks
        .map((task) => ({
            sourceTaskId: String(task.id),
            subject: String(task.name ?? "Untitled Task"),
            description: "",
            assignee: Array.isArray(task.assignees) && task.assignees.length > 0
                ? String(task.assignees[0]?.username ?? "")
                : "",
            week: getTaskWeekStr(task, activeWeekStr) || activeWeekStr,
            status: normalizeEditableStatusFromClickUp(task),
        }))
        .filter((task) => task.week === activeWeekStr);
}

function getTaskClientLabel(task: ClickUpTask | null) {
    const listName = String(task?.list?.name ?? "").trim();
    const projectName = String(task?.project?.name ?? "").trim();
    const folderName = String(task?.folder?.name ?? "").trim();
    return listName || projectName || folderName || "Unassigned Client";
}

function resolveCapacityClientLabel(task: ClickUpTask | null, clientLabels: string[]) {
    const candidates = [
        String(task?.list?.name ?? "").trim(),
        String(task?.project?.name ?? "").trim(),
        String(task?.folder?.name ?? "").trim(),
    ].filter(Boolean);

    if (candidates.length === 0) return "Unassigned Client";

    const normalizedClientLabels = clientLabels.map((label) => ({
        label,
        normalized: normalizeName(label),
    }));

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeName(candidate);
        if (!normalizedCandidate) continue;

        const exact = normalizedClientLabels.find((entry) => entry.normalized === normalizedCandidate);
        if (exact) return exact.label;

        const substringMatches = normalizedClientLabels
            .filter((entry) => entry.normalized && normalizedCandidate.includes(entry.normalized))
            .sort((a, b) => b.normalized.length - a.normalized.length);
        if (substringMatches[0]) return substringMatches[0].label;

        const reverseSubstringMatches = normalizedClientLabels
            .filter((entry) => entry.normalized && entry.normalized.includes(normalizedCandidate))
            .sort((a, b) => b.normalized.length - a.normalized.length);
        if (reverseSubstringMatches[0]) return reverseSubstringMatches[0].label;
    }

    return candidates[0];
}

function getDefaultBillableEntryDate(activeWeekStr: string): string {
    const start = new Date(`${activeWeekStr}T00:00:00`);
    const end = addDays(start, 4);
    const today = new Date();
    const todayKey = format(today, "yyyy-MM-dd");
    if (today >= start && today <= end) return todayKey;
    return activeWeekStr;
}

function getTaskWeeklyBillableHours(task: EditableTaskRecord): number {
    return (task.billableEntries || []).reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0);
}

function buildDefaultDraft(activeWeekStr: string): BillableEntryDraft {
    return {
        entryDate: getDefaultBillableEntryDate(activeWeekStr),
        hours: "",
        note: "",
        isValueAdd: false,
    };
}

export function Timesheets({
    activeWeekStr,
    tasks,
    consultants,
    capacityGrid,
    initialAssigneeFilter = null,
    onNavigateWeek,
    onAssigneeFilterChange,
    isWeekLoading = false,
}: TimesheetsProps) {
    const router = useRouter();
    const [editableTasks, setEditableTasks] = useState<EditableTaskRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedConsultant, setSelectedConsultant] = useState<string>(initialAssigneeFilter || consultants[0]?.name || "");
    const [entryDrafts, setEntryDrafts] = useState<Record<string, BillableEntryDraft>>({});
    const [isPending, startTransition] = useTransition();

    const activeWeekDate = useMemo(() => new Date(`${activeWeekStr}T00:00:00`), [activeWeekStr]);
    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;
    const weekNumber = format(activeWeekDate, "II");

    const consultantOptions = useMemo(
        () => consultants
            .map((consultant) => String(consultant.name || "").trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b)),
        [consultants]
    );

    useEffect(() => {
        if (!selectedConsultant && consultantOptions[0]) {
            setSelectedConsultant(consultantOptions[0]);
            return;
        }
        if (selectedConsultant && !consultantOptions.includes(selectedConsultant) && consultantOptions[0]) {
            setSelectedConsultant(consultantOptions[0]);
        }
    }, [consultantOptions, selectedConsultant]);

    useEffect(() => {
        if (!initialAssigneeFilter) return;
        if (consultantOptions.includes(initialAssigneeFilter)) {
            setSelectedConsultant(initialAssigneeFilter);
        }
    }, [consultantOptions, initialAssigneeFilter]);

    const seedTasks = useMemo(() => buildSeedTasks(tasks, activeWeekStr), [tasks, activeWeekStr]);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        (async () => {
            const rows = await getEditableTasks(activeWeekStr, "all", "all", seedTasks);
            if (cancelled) return;
            setEditableTasks(rows);
            setIsLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWeekStr, seedTasks]);

    const sourceTaskById = useMemo(() => {
        const byId = new Map<string, ClickUpTask>();
        tasks.forEach((task) => {
            const id = String(task?.id ?? "").trim();
            if (!id) return;
            byId.set(id, task);
        });
        return byId;
    }, [tasks]);

    const visibleTasks = useMemo(() => {
        const selectedKey = normalizeName(selectedConsultant);
        return editableTasks
            .filter((task) => normalizeName(task.assignee) === selectedKey)
            .filter((task) => task.status === "open")
            .sort((a, b) => {
                const taskA = a.sourceTaskId ? sourceTaskById.get(String(a.sourceTaskId)) : null;
                const taskB = b.sourceTaskId ? sourceTaskById.get(String(b.sourceTaskId)) : null;
                const clientCompare = getTaskClientLabel(taskA ?? null).localeCompare(getTaskClientLabel(taskB ?? null));
                if (clientCompare !== 0) return clientCompare;
                return a.subject.localeCompare(b.subject);
            });
    }, [editableTasks, selectedConsultant, sourceTaskById]);

    const capacityClientLabels = useMemo(
        () => (Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [])
            .map((row) => String(row?.client ?? "").trim())
            .filter(Boolean),
        [capacityGrid]
    );

    const plannedHoursByClient = useMemo(() => {
        const selectedKey = normalizeName(selectedConsultant);
        const resources = Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [];
        const rows = Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [];
        const matchedResource = resources.find((resource) => normalizeName(String(resource?.name ?? "")) === selectedKey);
        if (!matchedResource) return new Map<string, number>();

        const nextMap = new Map<string, number>();
        rows.forEach((row) => {
            const clientLabel = String(row?.client ?? "").trim();
            if (!clientLabel) return;
            const hours = Number(row?.allocations?.[matchedResource.id]?.hours ?? 0);
            if (hours <= 0) return;
            nextMap.set(clientLabel, Number(((nextMap.get(clientLabel) ?? 0) + hours).toFixed(1)));
        });
        return nextMap;
    }, [capacityGrid, selectedConsultant]);

    const taskRows = useMemo<TimesheetTaskRow[]>(() => {
        return visibleTasks.map((task) => {
            const sourceTask = task.sourceTaskId ? sourceTaskById.get(String(task.sourceTaskId)) : null;
            const clientLabel = resolveCapacityClientLabel(sourceTask ?? null, capacityClientLabels);
            const plannedHours = Number(plannedHoursByClient.get(clientLabel) ?? 0);
            const billedHours = Number(getTaskWeeklyBillableHours(task).toFixed(1));
            const entries = [...(task.billableEntries || [])].sort((a, b) => {
                if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
                return b.createdAt.localeCompare(a.createdAt);
            });

            return {
                task,
                clientLabel,
                plannedHours: Number(plannedHours.toFixed(1)),
                billedHours,
                remainingHours: 0,
                entries,
            };
        });
    }, [capacityClientLabels, plannedHoursByClient, sourceTaskById, visibleTasks]);

    useEffect(() => {
        setEntryDrafts((current) => {
            const nextDrafts: Record<string, BillableEntryDraft> = {};
            taskRows.forEach((row) => {
                nextDrafts[row.task.id] = current[row.task.id] ?? buildDefaultDraft(activeWeekStr);
            });
            return nextDrafts;
        });
    }, [activeWeekStr, taskRows]);

    const clientGroups = useMemo(() => {
        const groups = new Map<string, {
            clientLabel: string;
            plannedHours: number;
            billedHours: number;
            remainingHours: number;
            tasks: TimesheetTaskRow[];
        }>();

        taskRows.forEach((row) => {
            const existing = groups.get(row.clientLabel) ?? {
                clientLabel: row.clientLabel,
                plannedHours: Number(plannedHoursByClient.get(row.clientLabel) ?? 0),
                billedHours: 0,
                remainingHours: 0,
                tasks: [],
            };
            existing.billedHours += row.billedHours;
            existing.tasks.push(row);
            groups.set(row.clientLabel, existing);
        });

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                remainingHours: Number(Math.max(0, group.plannedHours - group.billedHours).toFixed(1)),
            }))
            .sort((a, b) => a.clientLabel.localeCompare(b.clientLabel));
    }, [plannedHoursByClient, taskRows]);

    const overallSummary = useMemo(() => {
        const plannedHours = Array.from(plannedHoursByClient.values()).reduce((sum, hours) => sum + Number(hours ?? 0), 0);
        const billedHours = clientGroups.reduce((sum, group) => sum + group.billedHours, 0);
        return {
            plannedHours: Number(plannedHours.toFixed(1)),
            billedHours: Number(billedHours.toFixed(1)),
            remainingHours: Number(Math.max(0, plannedHours - billedHours).toFixed(1)),
        };
    }, [clientGroups, plannedHoursByClient]);

    const handleDraftChange = (taskId: string, data: Partial<BillableEntryDraft>) => {
        setEntryDrafts((prev) => ({
            ...prev,
            [taskId]: {
                ...(prev[taskId] ?? buildDefaultDraft(activeWeekStr)),
                ...data,
            },
        }));
    };

    const handleSubmitEntry = (row: TimesheetTaskRow) => {
        const draft = entryDrafts[row.task.id] ?? buildDefaultDraft(activeWeekStr);
        const nextHours = Number(draft.hours || 0);
        if (!draft.entryDate || nextHours <= 0) return;

        startTransition(async () => {
            const created = await addEditableTaskBillableEntry({
                taskId: row.task.id,
                entryDate: draft.entryDate,
                hours: nextHours,
                note: draft.note,
                isValueAdd: draft.isValueAdd,
            });
            if (!created) return;

            setEditableTasks((prev) => prev.map((task) => {
                if (task.id !== row.task.id) return task;
                const nextEntries = [created, ...(task.billableEntries || [])].sort((a, b) => {
                    if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
                    return b.createdAt.localeCompare(a.createdAt);
                });
                return {
                    ...task,
                    billableEntries: nextEntries,
                };
            }));

            setEntryDrafts((prev) => ({
                ...prev,
                [row.task.id]: buildDefaultDraft(activeWeekStr),
            }));
        });
    };

    return (
        <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(21,26,43,0.96)_0%,rgba(13,18,29,0.96)_100%)] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Timesheets
                    </h2>
                    <div className="flex items-center overflow-hidden rounded-xl border border-border/60 bg-[#0f1320]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <button
                            onClick={() => {
                                const nextWeek = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
                                if (onNavigateWeek) {
                                    onNavigateWeek(nextWeek);
                                } else {
                                    router.push(`/?week=${nextWeek}&tab=timesheets`, { scroll: false });
                                }
                            }}
                            disabled={!onNavigateWeek && isWeekLoading}
                            className="flex h-10 w-10 items-center justify-center border-r border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white disabled:opacity-50"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="min-w-[220px] px-4 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Week W{weekNumber}</div>
                            <div className="mt-1 text-sm font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={() => {
                                const nextWeek = format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd");
                                if (onNavigateWeek) {
                                    onNavigateWeek(nextWeek);
                                } else {
                                    router.push(`/?week=${nextWeek}&tab=timesheets`, { scroll: false });
                                }
                            }}
                            disabled={!onNavigateWeek && isWeekLoading}
                            className="flex h-10 w-10 items-center justify-center border-l border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white disabled:opacity-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-xs text-text-muted">{weekLabel}</span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                        <span>Consultant</span>
                        <select
                            value={selectedConsultant}
                            onChange={(event) => {
                                const nextConsultant = event.target.value;
                                setSelectedConsultant(nextConsultant);
                                onAssigneeFilterChange?.(nextConsultant || null);
                            }}
                            className="rounded-md border border-border bg-surface/30 px-3 py-2 text-xs text-white outline-none focus:border-primary"
                        >
                            {consultantOptions.map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-[11px] text-text-muted">
                        {isWeekLoading ? "Loading..." : isLoading ? "Loading tasks..." : isPending ? "Saving..." : `${taskRows.length} active tasks · ${overallSummary.remainingHours.toFixed(1)}h remaining`}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Planned This Week</div>
                    <div className="mt-2 text-4xl font-bold text-white">{overallSummary.plannedHours.toFixed(1)}</div>
                </div>
                <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Actuals This Week</div>
                    <div className="mt-2 text-4xl font-bold text-white">{overallSummary.billedHours.toFixed(1)}</div>
                </div>
                <div className="rounded-[24px] border border-primary/30 bg-[linear-gradient(180deg,rgba(29,39,69,0.98)_0%,rgba(16,24,44,0.98)_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Remaining To Bill</div>
                    <div className="mt-2 text-5xl font-bold text-white">{overallSummary.remainingHours.toFixed(1)}</div>
                    <div className="mt-2 text-xs text-text-muted">Across all active client work for {selectedConsultant || "this consultant"}.</div>
                </div>
            </div>

            <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-5 py-4 text-xs text-text-muted shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                This screen uses Capacity Grid planned hours as the source of truth for each consultant&apos;s client totals. It shows active tasks, billed hours so far, and remaining hours to bill by client.
            </div>

            {clientGroups.length === 0 && (
                <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-6 py-12 text-center text-sm text-text-muted shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    {selectedConsultant
                        ? `No active timesheet tasks found for ${selectedConsultant} in this week.`
                        : "Select a consultant to view timesheets."}
                </div>
            )}

            <div className="space-y-5">
                {clientGroups.map((group) => (
                    <div
                        key={group.clientLabel}
                        className="overflow-hidden rounded-[28px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
                    >
                        <div className="border-b border-border/40 px-5 py-4">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div>
                                    <div className="text-lg font-semibold text-white">{group.clientLabel}</div>
                                    <div className="mt-1 text-xs text-text-muted">{group.tasks.length} active task{group.tasks.length === 1 ? "" : "s"}</div>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap">
                                    <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Planned</div>
                                        <div className="mt-1 text-xl font-semibold text-white">{group.plannedHours.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Actuals</div>
                                        <div className="mt-1 text-xl font-semibold text-white">{group.billedHours.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Remaining To Bill</div>
                                        <div className="mt-1 text-2xl font-semibold text-white">{group.remainingHours.toFixed(1)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="divide-y divide-border/30">
                            {group.tasks.map((row, index) => {
                                const draft = entryDrafts[row.task.id] ?? buildDefaultDraft(activeWeekStr);
                                const hoursValue = Number(draft.hours || 0);
                                const showWarning = hoursValue > 0 && group.remainingHours > 0.01 && hoursValue > group.remainingHours + 0.01;

                                return (
                                    <div
                                        key={row.task.id}
                                        className={cn(
                                            "px-5 py-5",
                                            index % 2 === 0 ? "bg-[#0d121d]/68" : "bg-[#101622]/74"
                                        )}
                                    >
                                        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_220px_minmax(0,1.4fr)]">
                                            <div className="space-y-3">
                                                <div>
                                                    <div className="text-base font-semibold text-white">{row.task.subject}</div>
                                                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-text-muted">{row.task.status}</div>
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                    <div className="rounded-xl border border-border/50 bg-background/25 px-3 py-3">
                                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Planned</div>
                                                        <div className="mt-1 text-lg font-semibold text-white">{row.plannedHours.toFixed(1)}</div>
                                                    </div>
                                                    <div className="rounded-xl border border-border/50 bg-background/25 px-3 py-3">
                                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Actuals</div>
                                                        <div className="mt-1 text-lg font-semibold text-white">{row.billedHours.toFixed(1)}</div>
                                                    </div>
                                                    <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-3">
                                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Client Remaining</div>
                                                        <div className="mt-1 text-lg font-semibold text-white">{group.remainingHours.toFixed(1)}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3 rounded-2xl border border-border/50 bg-background/25 px-4 py-4">
                                                <div className="text-sm font-semibold text-white">Submit Billable Entry</div>
                                                <label className="block space-y-1">
                                                    <span className="text-[11px] uppercase tracking-wider text-text-muted">Date</span>
                                                    <input
                                                        type="date"
                                                        value={draft.entryDate}
                                                        onChange={(event) => handleDraftChange(row.task.id, { entryDate: event.target.value })}
                                                        className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                    />
                                                </label>
                                                <label className="block space-y-1">
                                                    <span className="text-[11px] uppercase tracking-wider text-text-muted">Hours</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.25"
                                                        value={draft.hours}
                                                        onChange={(event) => handleDraftChange(row.task.id, { hours: event.target.value })}
                                                        placeholder={group.remainingHours > 0 ? `${group.remainingHours.toFixed(1)} remaining for client` : "0.0"}
                                                        className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                    />
                                                </label>
                                                <label className="block space-y-1">
                                                    <span className="text-[11px] uppercase tracking-wider text-text-muted">Note</span>
                                                    <input
                                                        type="text"
                                                        value={draft.note}
                                                        onChange={(event) => handleDraftChange(row.task.id, { note: event.target.value })}
                                                        placeholder="Optional billing note"
                                                        className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                    />
                                                </label>
                                                <label className="flex items-center gap-3 rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white">
                                                    <input
                                                        type="checkbox"
                                                        checked={draft.isValueAdd}
                                                        onChange={(event) => handleDraftChange(row.task.id, { isValueAdd: event.target.checked })}
                                                        className="h-4 w-4 rounded border-border bg-background/60 text-primary focus:ring-primary"
                                                    />
                                                    <span>Value Add</span>
                                                </label>
                                                {showWarning && (
                                                    <div className="text-xs text-amber-300">
                                                        This entry is above the current remaining hours for this client.
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleSubmitEntry(row)}
                                                    disabled={isPending || !draft.entryDate || Number(draft.hours || 0) <= 0}
                                                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-main hover:bg-surface-hover disabled:opacity-50"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    Submit
                                                </button>
                                            </div>

                                            <div className="rounded-2xl border border-border/50 bg-background/25 px-4 py-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-semibold text-white">Billable History</div>
                                                        <div className="mt-1 text-xs text-text-muted">{row.billedHours.toFixed(1)}h logged this week</div>
                                                    </div>
                                                </div>
                                                <div className="mt-3 space-y-2">
                                                    {row.entries.length === 0 && (
                                                        <div className="text-sm text-text-muted">No billable entries logged yet for this task.</div>
                                                    )}
                                                    {row.entries.map((entry) => (
                                                        <div key={entry.id} className="rounded-xl border border-border/40 bg-background/50 px-3 py-3">
                                                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                                                <div className="text-sm font-medium text-white">
                                                                    {entry.hours.toFixed(2)}h on {format(new Date(`${entry.entryDate}T00:00:00`), "MMM d, yyyy")}
                                                                </div>
                                                                <span className={cn(
                                                                    "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                                                    entry.isValueAdd ? "bg-emerald-500/15 text-emerald-300" : "bg-surface/70 text-text-muted"
                                                                )}>
                                                                    {entry.isValueAdd ? "Value Add" : "Standard"}
                                                                </span>
                                                            </div>
                                                            <div className="mt-2 text-xs text-text-muted">
                                                                {entry.note || "No note"}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
