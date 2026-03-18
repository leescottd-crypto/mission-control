"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, GripVertical, Plus, Save, Trash2, X } from "lucide-react";
import {
    addEditableTaskBillableEntry,
    createEditableTask,
    deleteEditableTaskBillableEntry,
    EditableTaskBillableEntryRecord,
    deleteEditableTask,
    EditableTaskRecord,
    EditableTaskSeed,
    getEditableTasks,
    updateEditableTask,
} from "@/app/actions";
import { ClickUpTask } from "@/lib/clickup";
import { cn } from "@/lib/utils";

interface EditableTaskBoardProps {
    activeWeekStr: string;
    tasks: ClickUpTask[];
    scopeType: "all" | "list" | "folder";
    scopeId: string;
    scopeName: string;
    assigneeOptions?: string[];
    initialAssigneeFilter?: string | null;
    tabId?: string;
}

type EditableStatus = "backlog" | "open" | "closed";

type EditableTaskFormState = {
    id: string;
    subject: string;
    description: string;
    assignee: string;
    week: string;
    status: EditableStatus;
};

type TaskEditorTab = "details" | "billable";

type BillableEntryDraft = {
    entryDate: string;
    hours: number;
    note: string;
};

const STATUS_COLUMNS: Array<{ id: EditableStatus; label: string }> = [
    { id: "backlog", label: "Backlog" },
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
];

function normalizeEditableStatusFromClickUp(task: ClickUpTask): EditableStatus {
    const statusText = String(task?.status?.status ?? "").toLowerCase();
    const statusType = String(task?.status?.type ?? "").toLowerCase();
    if (statusType === "closed" || /(complete|completed|done|closed|resolved|shipped)/.test(statusText)) return "closed";
    if (/(backlog|not started|todo|to do|new|queued|queue|planned|plan|pending)/.test(statusText)) return "backlog";
    return "open";
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

function normalizeScopeValue(value: string): string {
    return String(value || "").trim().toLowerCase();
}

function getClientLabelForTask(task: ClickUpTask): string {
    const listName = String(task?.list?.name ?? "").trim();
    const projectName = String(task?.project?.name ?? "").trim();
    const folderName = String(task?.folder?.name ?? "").trim();
    return listName || projectName || folderName || "Unassigned Client";
}

function filterTasksByScope(
    tasks: ClickUpTask[],
    scopeType: "all" | "list" | "folder",
    scopeId: string,
    scopeName: string
) {
    const normalizedScopeId = String(scopeId || "").trim();
    const normalizedScopeName = normalizeScopeValue(scopeName);

    if (scopeType === "list") {
        return tasks.filter((task) => {
            const listId = String(task?.list?.id ?? "").trim();
            const projectId = String(task?.project?.id ?? "").trim();
            const listName = normalizeScopeValue(task?.list?.name ?? "");
            const projectName = normalizeScopeValue(task?.project?.name ?? "");
            return (
                listId === normalizedScopeId ||
                projectId === normalizedScopeId ||
                (normalizedScopeName.length > 0 && (listName === normalizedScopeName || projectName === normalizedScopeName))
            );
        });
    }
    if (scopeType === "folder") {
        return tasks.filter((task) => {
            const folderId = String(task?.folder?.id ?? "").trim();
            const folderName = normalizeScopeValue(task?.folder?.name ?? "");
            return (
                folderId === normalizedScopeId ||
                (normalizedScopeName.length > 0 && folderName === normalizedScopeName)
            );
        });
    }
    return tasks;
}

function buildSeedTasks(
    tasks: ClickUpTask[],
    activeWeekStr: string
): EditableTaskSeed[] {
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

function toWeekStart(value: string): string {
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return format(startOfWeek(parsed, { weekStartsOn: 1 }), "yyyy-MM-dd");
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

function buildWeekNavigationHref(nextWeekStr: string, tabId: string): string {
    const params = new URLSearchParams(window.location.search);
    params.set("week", nextWeekStr);
    params.set("tab", tabId);
    return `/?${params.toString()}`;
}

function buildAssigneeFilterHref(assignee: string | null, tabId: string): string {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tabId);
    if (assignee && assignee.trim().length > 0) {
        params.set("assignee", assignee.trim());
    } else {
        params.delete("assignee");
    }
    return `/?${params.toString()}`;
}

function getTaskClientDisplayLabel(
    task: EditableTaskRecord,
    scopeType: "all" | "list" | "folder",
    scopeName: string,
    taskClientLabelBySourceTaskId: Map<string, string>
): string {
    if (scopeType !== "all") return scopeName;
    if (!task.sourceTaskId) return scopeName;
    return taskClientLabelBySourceTaskId.get(String(task.sourceTaskId)) ?? scopeName;
}

export function EditableTaskBoard({
    activeWeekStr,
    tasks,
    scopeType,
    scopeId,
    scopeName,
    assigneeOptions = [],
    initialAssigneeFilter = null,
    tabId = "issues",
}: EditableTaskBoardProps) {
    const [boardTasks, setBoardTasks] = useState<EditableTaskRecord[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [editorState, setEditorState] = useState<EditableTaskFormState | null>(null);
    const [isCenteredEditorOpen, setIsCenteredEditorOpen] = useState(false);
    const [editorTab, setEditorTab] = useState<TaskEditorTab>("details");
    const [returnToHref, setReturnToHref] = useState<string | null>(null);
    const [billableEntryDraft, setBillableEntryDraft] = useState<BillableEntryDraft>({
        entryDate: getDefaultBillableEntryDate(activeWeekStr),
        hours: 0,
        note: "",
    });
    const [dragTaskId, setDragTaskId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const [isLoading, setIsLoading] = useState(false);

    const activeWeekDate = useMemo(() => new Date(`${activeWeekStr}T00:00:00`), [activeWeekStr]);
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    const scopedTasks = useMemo(
        () => filterTasksByScope(tasks, scopeType, scopeId, scopeName),
        [tasks, scopeType, scopeId, scopeName]
    );

    const seedTasks = useMemo(
        () => buildSeedTasks(scopedTasks, activeWeekStr),
        [scopedTasks, activeWeekStr]
    );

    const taskClientLabelBySourceTaskId = useMemo(() => {
        const entries = tasks
            .map((task) => [String(task?.id ?? "").trim(), getClientLabelForTask(task)] as const)
            .filter((entry) => entry[0].length > 0);
        return new Map(entries);
    }, [tasks]);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        (async () => {
            const rows = await getEditableTasks(activeWeekStr, scopeType, scopeId, seedTasks);
            if (cancelled) return;
            setBoardTasks(rows);
            setIsLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWeekStr, scopeType, scopeId, seedTasks]);

    useEffect(() => {
        if (!selectedTaskId) {
            setEditorState(null);
            return;
        }
        const task = boardTasks.find((item) => item.id === selectedTaskId);
        if (!task) {
            setEditorState(null);
            setSelectedTaskId(null);
            return;
        }
        setEditorState({
            id: task.id,
            subject: task.subject,
            description: task.description,
            assignee: task.assignee,
            week: task.week,
            status: task.status,
        });
        setEditorTab("details");
        setBillableEntryDraft({
            entryDate: getDefaultBillableEntryDate(activeWeekStr),
            hours: 0,
            note: "",
        });
    }, [selectedTaskId, boardTasks, activeWeekStr]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const value = params.get("returnTo");
        setReturnToHref(value && value.trim().length > 0 ? value : null);
    }, [activeWeekStr, scopeId, scopeType, initialAssigneeFilter]);

    const groupedTasks = useMemo(() => {
        const map: Record<EditableStatus, EditableTaskRecord[]> = {
            backlog: [],
            open: [],
            closed: [],
        };
        const normalizedAssigneeFilter = normalizeScopeValue(initialAssigneeFilter ?? "");
        const visibleBoardTasks = normalizedAssigneeFilter
            ? boardTasks.filter((task) => normalizeScopeValue(task.assignee) === normalizedAssigneeFilter)
            : boardTasks;

        visibleBoardTasks.forEach((task) => {
            map[task.status].push(task);
        });
        (Object.keys(map) as EditableStatus[]).forEach((status) => {
            map[status] = map[status].slice().sort((a, b) => {
                const clientA = String(
                    a.sourceTaskId ? taskClientLabelBySourceTaskId.get(String(a.sourceTaskId)) ?? "" : ""
                );
                const clientB = String(
                    b.sourceTaskId ? taskClientLabelBySourceTaskId.get(String(b.sourceTaskId)) ?? "" : ""
                );
                if (scopeType === "all") {
                    const clientCompare = clientA.localeCompare(clientB);
                    if (clientCompare !== 0) return clientCompare;
                }
                return a.position - b.position || a.subject.localeCompare(b.subject);
            });
        });
        return map;
    }, [boardTasks, initialAssigneeFilter, scopeType, taskClientLabelBySourceTaskId]);

    const persistTaskUpdate = (taskId: string, patch: Partial<EditableTaskRecord>) => {
        setBoardTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
        startTransition(() => {
            updateEditableTask(taskId, patch);
        });
    };

    const handleCreateTask = async () => {
        const created = await createEditableTask({
            week: activeWeekStr,
            scopeType,
            scopeId,
            subject: "New Task",
            description: "",
            assignee: "",
            billableHoursToday: 0,
            status: "backlog",
        });
        if (!created) return;
        setBoardTasks((prev) => [...prev, created]);
        setSelectedTaskId(created.id);
        setIsCenteredEditorOpen(true);
    };

    const handleDeleteTask = async (taskId: string) => {
        setBoardTasks((prev) => prev.filter((item) => item.id !== taskId));
        if (selectedTaskId === taskId) setSelectedTaskId(null);
        setIsCenteredEditorOpen(false);
        await deleteEditableTask(taskId);
    };

    const handleDropToStatus = (status: EditableStatus) => {
        if (!dragTaskId) return;
        const draggedTask = boardTasks.find((task) => task.id === dragTaskId);
        if (!draggedTask) return;
        const nextPosition = Math.max(
            0,
            ...boardTasks.filter((task) => task.status === status && task.id !== dragTaskId).map((task) => Number(task.position || 0))
        ) + 1;
        persistTaskUpdate(dragTaskId, { status, position: nextPosition });
        setDragTaskId(null);
    };

    const handleSaveEditor = () => {
        if (!editorState) return;
        const normalizedWeek = toWeekStart(editorState.week);
        persistTaskUpdate(editorState.id, {
            subject: editorState.subject.trim() || "Untitled Task",
            description: editorState.description,
            assignee: editorState.assignee,
            week: normalizedWeek,
            status: editorState.status,
        });
        if (normalizedWeek !== activeWeekStr) {
            setBoardTasks((prev) => prev.filter((task) => task.id !== editorState.id));
            setSelectedTaskId(null);
            setIsCenteredEditorOpen(false);
        }
    };

    const assigneePickList = useMemo(() => {
        const values = new Set(
            assigneeOptions
                .map((name) => String(name || "").trim())
                .filter(Boolean)
        );
        const currentAssignee = String(editorState?.assignee ?? "").trim();
        if (currentAssignee) values.add(currentAssignee);
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [assigneeOptions, editorState?.assignee]);

    const assigneeFilterOptions = useMemo(() => {
        const values = new Set(
            assigneeOptions
                .map((name) => String(name || "").trim())
                .filter(Boolean)
        );
        const currentFilter = String(initialAssigneeFilter ?? "").trim();
        if (currentFilter) values.add(currentFilter);
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [assigneeOptions, initialAssigneeFilter]);

    const selectedTask = useMemo(
        () => boardTasks.find((task) => task.id === selectedTaskId) ?? null,
        [boardTasks, selectedTaskId]
    );

    const handleAddBillableEntry = async () => {
        if (!selectedTask || !billableEntryDraft.entryDate) return;
        const created = await addEditableTaskBillableEntry({
            taskId: selectedTask.id,
            entryDate: billableEntryDraft.entryDate,
            hours: Number(billableEntryDraft.hours ?? 0),
            note: billableEntryDraft.note,
        });
        if (!created) return;

        setBoardTasks((prev) => prev.map((task) => {
            if (task.id !== selectedTask.id) return task;
            const nextEntries = [created, ...(task.billableEntries || [])].sort((a, b) => {
                if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
                return b.createdAt.localeCompare(a.createdAt);
            });
            return {
                ...task,
                billableEntries: nextEntries,
            };
        }));
        setBillableEntryDraft({
            entryDate: getDefaultBillableEntryDate(activeWeekStr),
            hours: 0,
            note: "",
        });
    };

    const handleDeleteBillableEntry = async (entry: EditableTaskBillableEntryRecord) => {
        await deleteEditableTaskBillableEntry(entry.id);
        setBoardTasks((prev) => prev.map((task) => {
            if (task.id !== entry.taskId) return task;
            return {
                ...task,
                billableEntries: (task.billableEntries || []).filter((item) => item.id !== entry.id),
            };
        }));
    };

    const handleReturnToCapacityGrid = () => {
        if (typeof window === "undefined") return;
        if (returnToHref) {
            window.location.href = returnToHref;
            return;
        }
        window.history.back();
    };

    const renderTaskEditorFields = () => (
        <>
            {editorState && boardTasks.find((task) => task.id === editorState.id)?.sourceTaskId && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-text-muted">
                    Seeded from the original ClickUp task and editable locally on this weekly board.
                </div>
            )}
            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Subject</span>
                <input
                    type="text"
                    value={editorState?.subject ?? ""}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, subject: event.target.value } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Description</span>
                <textarea
                    value={editorState?.description ?? ""}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, description: event.target.value } : prev)}
                    rows={5}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary resize-none"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Assignee</span>
                <select
                    value={editorState?.assignee ?? ""}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, assignee: event.target.value } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                >
                    <option value="">Unassigned</option>
                    {assigneePickList.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Week Of</span>
                <input
                    type="date"
                    value={editorState?.week ?? activeWeekStr}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, week: event.target.value } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Status</span>
                <select
                    value={editorState?.status ?? "backlog"}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, status: event.target.value as EditableStatus } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                >
                    {STATUS_COLUMNS.map((column) => (
                        <option key={column.id} value={column.id}>
                            {column.label}
                        </option>
                    ))}
                </select>
            </label>

            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={handleSaveEditor}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                >
                    <Save className="w-4 h-4" />
                    Save Task
                </button>
                {editorState && (
                    <button
                        type="button"
                        onClick={() => handleDeleteTask(editorState.id)}
                        className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-200 hover:bg-red-500/10"
                    >
                        <Trash2 className="w-4 h-4" />
                        Delete
                    </button>
                )}
            </div>
        </>
    );

    const renderBillableHistoryTab = () => {
        const entries = selectedTask?.billableEntries || [];
        const totalHours = selectedTask ? getTaskWeeklyBillableHours(selectedTask) : 0;

        return (
            <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-text-muted">
                    Logged billable hours here will roll up into Capacity Grid actuals for this consultant and client.
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_120px_minmax(0,1fr)_auto]">
                    <label className="block space-y-1">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">Date</span>
                        <input
                            type="date"
                            value={billableEntryDraft.entryDate}
                            onChange={(event) => setBillableEntryDraft((prev) => ({ ...prev, entryDate: event.target.value }))}
                            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                        />
                    </label>
                    <label className="block space-y-1">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">Hours</span>
                        <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={billableEntryDraft.hours}
                            onChange={(event) => setBillableEntryDraft((prev) => ({ ...prev, hours: Number(event.target.value || 0) }))}
                            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                        />
                    </label>
                    <label className="block space-y-1">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">Note</span>
                        <input
                            type="text"
                            value={billableEntryDraft.note}
                            onChange={(event) => setBillableEntryDraft((prev) => ({ ...prev, note: event.target.value }))}
                            placeholder="Optional billing note"
                            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                        />
                    </label>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={handleAddBillableEntry}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                        >
                            <Plus className="w-4 h-4" />
                            Add Entry
                        </button>
                    </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-background/30">
                    <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                        <div>
                            <div className="text-sm font-semibold text-white">Billable History</div>
                            <div className="text-xs text-text-muted">{totalHours.toFixed(2)}h logged for this week</div>
                        </div>
                    </div>
                    <div className="divide-y divide-border/30">
                        {entries.length === 0 && (
                            <div className="px-4 py-8 text-sm text-text-muted">No billable entries logged yet for this task.</div>
                        )}
                        {entries.map((entry) => (
                            <div key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-white">
                                        {entry.hours.toFixed(2)}h on {format(new Date(`${entry.entryDate}T00:00:00`), "MMM d, yyyy")}
                                    </div>
                                    <div className="mt-1 text-xs text-text-muted">
                                        {entry.note || "No note"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteBillableEntry(entry)}
                                    className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Editable Tasks
                    </h2>
                    {returnToHref && (
                        <button
                            type="button"
                            onClick={handleReturnToCapacityGrid}
                            className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-surface/20 px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-surface-hover"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            Back To Capacity Grid
                        </button>
                    )}
                    <div className="flex items-center rounded-md border border-border/70 overflow-hidden bg-surface/20">
                        <button
                            onClick={() => { window.location.href = buildWeekNavigationHref(format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd"), tabId); }}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-r border-border/70"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="px-3 py-1.5 min-w-[190px]">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">Week</div>
                            <div className="text-xs font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={() => { window.location.href = buildWeekNavigationHref(format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd"), tabId); }}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-l border-border/70"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <span className="text-xs text-text-muted">Scope: {scopeName}</span>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                        <span>Assignee</span>
                        <select
                            value={initialAssigneeFilter ?? ""}
                            onChange={(event) => { window.location.href = buildAssigneeFilterHref(event.target.value || null, tabId); }}
                            className="rounded-md border border-border bg-surface/30 px-2 py-1.5 text-xs text-white outline-none focus:border-primary"
                        >
                            <option value="">All Active Consultants</option>
                            {assigneeFilterOptions.map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={handleCreateTask}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-main hover:bg-surface-hover"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add Task
                    </button>
                    <span className="text-[11px] text-text-muted">
                        {isPending
                            ? "Saving..."
                            : isLoading
                                ? "Loading..."
                                : `${Object.values(groupedTasks).reduce((sum, items) => sum + items.length, 0)} editable tasks from ${scopedTasks.length} scoped ClickUp tasks`}
                    </span>
                </div>
            </div>

            <div className="text-xs text-text-muted">
                Original ClickUp tasks for this scope/week are used as editable placeholders here.
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 min-h-[640px]">
                <div className="border border-border/50 bg-surface/20 rounded-xl p-4 overflow-hidden">
                    <div className="flex gap-4 overflow-x-auto pb-2 h-full">
                        {STATUS_COLUMNS.map((column) => {
                            const columnTasks = groupedTasks[column.id];
                            return (
                                <div
                                    key={column.id}
                                    className="flex-shrink-0 w-[320px] rounded-xl border border-border/40 bg-background/40 p-3 flex flex-col"
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={() => handleDropToStatus(column.id)}
                                >
                                    <div className="flex items-center justify-between px-1 pb-3 border-b border-border/30">
                                        <h3 className="text-sm font-semibold text-white">{column.label}</h3>
                                        <span className="text-xs bg-surface-hover text-text-muted px-1.5 py-0.5 rounded-full font-mono">
                                            {columnTasks.length}
                                        </span>
                                    </div>
                                    <div className="pt-3 space-y-2 overflow-y-auto custom-scrollbar min-h-[540px]">
                                        {columnTasks.map((task) => (
                                            <div
                                                key={task.id}
                                                draggable
                                                onDragStart={() => setDragTaskId(task.id)}
                                                onClick={() => setSelectedTaskId(task.id)}
                                                onDoubleClick={() => {
                                                    setSelectedTaskId(task.id);
                                                    setIsCenteredEditorOpen(true);
                                                }}
                                                className={cn(
                                                    "rounded-lg border border-border/40 bg-surface/30 p-3 cursor-pointer hover:bg-surface-hover/50 transition-colors",
                                                    selectedTaskId === task.id && "border-primary/50 bg-primary/10"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-text-muted">
                                                            {getTaskClientDisplayLabel(task, scopeType, scopeName, taskClientLabelBySourceTaskId)}
                                                        </div>
                                                        <div className="text-sm font-semibold text-white truncate">{task.subject}</div>
                                                        {task.description && (
                                                            <div className="mt-1 text-xs text-text-muted line-clamp-3">{task.description}</div>
                                                        )}
                                                        {task.sourceTaskId && (
                                                            <div className="mt-2">
                                                                <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                                                                    ClickUp Placeholder
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <GripVertical className="w-4 h-4 text-text-muted shrink-0" />
                                                </div>
                                                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                                                    <span className="truncate">{task.assignee || "Unassigned"}</span>
                                                    <div className="flex items-center gap-3">
                                                        <span>{getTaskWeeklyBillableHours(task).toFixed(2)}h logged</span>
                                                        <span>{format(new Date(`${task.week}T00:00:00`), "'Wk Of' MMM d")}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {columnTasks.length === 0 && (
                                            <div className="rounded-lg border border-dashed border-border/40 py-10 text-center text-xs text-text-muted">
                                                Drop tasks here
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/50 bg-surface/30 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-text-main">Task Editor</h3>
                        {editorState && (
                            <button
                                type="button"
                                onClick={() => handleDeleteTask(editorState.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                            </button>
                        )}
                    </div>
                    <div className="p-4 space-y-4">
                        {!editorState && (
                            <div className="rounded-lg border border-dashed border-border/40 py-16 text-center text-sm text-text-muted">
                                Select a task to edit it.
                            </div>
                        )}

                        {editorState && (
                            <>
                                <div className="inline-flex rounded-lg border border-border/50 bg-background/40 p-1">
                                    <button
                                        type="button"
                                        onClick={() => setEditorTab("details")}
                                        className={cn(
                                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                            editorTab === "details" ? "bg-primary/15 text-white" : "text-text-muted hover:text-white"
                                        )}
                                    >
                                        Details
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditorTab("billable")}
                                        className={cn(
                                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                            editorTab === "billable" ? "bg-primary/15 text-white" : "text-text-muted hover:text-white"
                                        )}
                                    >
                                        Billable Log
                                    </button>
                                </div>
                                {editorTab === "details" ? renderTaskEditorFields() : renderBillableHistoryTab()}
                            </>
                        )}
                    </div>
                </div>
            </div>
            {isCenteredEditorOpen && editorState && (
                <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div>
                                <div className="text-sm font-semibold text-text-main">Task Editor</div>
                                <div className="mt-1 text-xs text-text-muted">
                                    {scopeName} · {editorState.subject || "Untitled Task"}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCenteredEditorOpen(false)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                                aria-label="Close task editor"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="max-h-[75vh] overflow-y-auto p-5 space-y-4">
                            <div className="inline-flex rounded-lg border border-border/50 bg-background/40 p-1">
                                <button
                                    type="button"
                                    onClick={() => setEditorTab("details")}
                                    className={cn(
                                        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                        editorTab === "details" ? "bg-primary/15 text-white" : "text-text-muted hover:text-white"
                                    )}
                                >
                                    Details
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditorTab("billable")}
                                    className={cn(
                                        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                        editorTab === "billable" ? "bg-primary/15 text-white" : "text-text-muted hover:text-white"
                                    )}
                                >
                                    Billable Log
                                </button>
                            </div>
                            {editorTab === "details" ? renderTaskEditorFields() : renderBillableHistoryTab()}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
