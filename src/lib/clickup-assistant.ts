import { endOfWeek, format, startOfWeek, subDays } from "date-fns";

import {
    ClickUpTask,
    PROFESSIONAL_SERVICES_SPACE_ID,
    TimeEntry,
    getTeamTasks,
    getTeamTimeEntries,
} from "@/lib/clickup";

type AssistantIntent = "overview" | "overdue" | "blocked" | "time" | "assignee" | "actions";

export interface ClickUpAssistantReply {
    mode: "rules";
    status: "ready";
    title: string;
    summary: string;
    bullets: string[];
    suggestions: string[];
    meta: {
        providerLabel: string;
        llmEnabled: false;
        taskCount: number;
        timeEntryCount: number;
        windowLabel: string;
    };
}

interface WorkspaceSnapshot {
    tasks: ClickUpTask[];
    weekTimeEntries: TimeEntry[];
    weekStart: Date;
    weekEnd: Date;
}

function normalizeText(value: string) {
    return String(value || "").trim().toLowerCase();
}

function isClosedTask(task: ClickUpTask) {
    const status = normalizeText(task.status?.status);
    const type = normalizeText(task.status?.type);
    return type === "closed" || status === "complete" || status === "completed" || status === "done";
}

function isBlockedTask(task: ClickUpTask) {
    const status = normalizeText(task.status?.status);
    return /block|hold|waiting|stuck/.test(status);
}

function isOverdueTask(task: ClickUpTask, now: Date) {
    if (!task.due_date || isClosedTask(task)) return false;
    const due = Number(task.due_date);
    return Number.isFinite(due) && due < now.getTime();
}

function toHours(ms: number | null | undefined) {
    return Number((((Number(ms) || 0) / (1000 * 60 * 60))).toFixed(1));
}

function getTopAssignees(tasks: ClickUpTask[]) {
    const counts = new Map<string, number>();

    tasks.forEach((task) => {
        if (!Array.isArray(task.assignees) || task.assignees.length === 0) {
            counts.set("Unassigned", (counts.get("Unassigned") || 0) + 1);
            return;
        }

        task.assignees.forEach((assignee) => {
            const name = String(assignee?.username || "").trim() || "Unknown";
            counts.set(name, (counts.get(name) || 0) + 1);
        });
    });

    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
}

function getTopTimeUsers(entries: TimeEntry[]) {
    const byUser = new Map<string, number>();

    entries.forEach((entry) => {
        const name = String(entry?.user?.username || "").trim() || "Unknown";
        byUser.set(name, (byUser.get(name) || 0) + Number(entry?.duration || 0));
    });

    return Array.from(byUser.entries())
        .map(([name, duration]) => ({ name, hours: toHours(duration) }))
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 3);
}

function detectIntent(question: string): AssistantIntent {
    const q = normalizeText(question);

    if (!q) return "overview";
    if (/create|add|update|move|assign|comment/.test(q)) return "actions";
    if (/overdue|late|due/.test(q)) return "overdue";
    if (/block|blocked|stuck|waiting|hold/.test(q)) return "blocked";
    if (/time|hours|logged|spent/.test(q)) return "time";
    if (/assignee|owner|who|workload|capacity/.test(q)) return "assignee";
    return "overview";
}

async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const tasks = await getTeamTasks();
    const timeEntries = await getTeamTimeEntries(weekStart.getTime(), weekEnd.getTime());
    const validTasks = Array.isArray(tasks)
        ? tasks.filter((task) => task.space?.id === PROFESSIONAL_SERVICES_SPACE_ID)
        : [];
    const validTimeEntries = Array.isArray(timeEntries) ? timeEntries : [];

    return {
        tasks: validTasks,
        weekTimeEntries: validTimeEntries,
        weekStart,
        weekEnd,
    };
}

function buildOverviewReply(snapshot: WorkspaceSnapshot): Omit<ClickUpAssistantReply, "mode" | "status"> {
    const now = new Date();
    const openTasks = snapshot.tasks.filter((task) => !isClosedTask(task));
    const closedTasks = snapshot.tasks.length - openTasks.length;
    const overdueTasks = openTasks.filter((task) => isOverdueTask(task, now));
    const blockedTasks = openTasks.filter(isBlockedTask);
    const topAssignees = getTopAssignees(openTasks);
    const weekHours = toHours(snapshot.weekTimeEntries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0));

    return {
        title: "Workspace overview",
        summary: `${openTasks.length} open tasks, ${closedTasks} closed, and ${weekHours} hours logged for the current week.`,
        bullets: [
            `${overdueTasks.length} overdue tasks need attention.`,
            `${blockedTasks.length} tasks are in blocked or waiting states.`,
            topAssignees.length > 0
                ? `Heaviest owners right now: ${topAssignees.map(([name, count]) => `${name} (${count})`).join(", ")}.`
                : "No assignee hotspots yet.",
        ],
        suggestions: [
            "What is overdue right now?",
            "Who has the heaviest workload?",
            "Summarize this week's logged time",
        ],
        meta: {
            providerLabel: "Deterministic REST snapshot",
            llmEnabled: false,
            taskCount: snapshot.tasks.length,
            timeEntryCount: snapshot.weekTimeEntries.length,
            windowLabel: `${format(snapshot.weekStart, "MMM d")} - ${format(snapshot.weekEnd, "MMM d")}`,
        },
    };
}

function buildIntentReply(question: string, snapshot: WorkspaceSnapshot): Omit<ClickUpAssistantReply, "mode" | "status"> {
    const intent = detectIntent(question);
    const now = new Date();
    const openTasks = snapshot.tasks.filter((task) => !isClosedTask(task));
    const overdueTasks = openTasks
        .filter((task) => isOverdueTask(task, now))
        .sort((a, b) => Number(a.due_date || 0) - Number(b.due_date || 0))
        .slice(0, 5);
    const blockedTasks = openTasks.filter(isBlockedTask).slice(0, 5);
    const topTimeUsers = getTopTimeUsers(snapshot.weekTimeEntries);
    const topAssignees = getTopAssignees(openTasks);

    if (intent === "overdue") {
        return {
            title: "Overdue work",
            summary: overdueTasks.length > 0
                ? `Found ${overdueTasks.length} overdue tasks in Professional Services.`
                : "No overdue tasks are visible in the current Professional Services snapshot.",
            bullets: overdueTasks.length > 0
                ? overdueTasks.map((task) => {
                    const dueLabel = task.due_date ? format(new Date(Number(task.due_date)), "MMM d") : "No due date";
                    return `${task.name} (${task.list?.name || "No list"}) was due ${dueLabel}.`;
                })
                : [
                    "Ask for blocked work or workload if you want a different risk view.",
                ],
            suggestions: [
                "Show blocked items instead",
                "Who owns the most open work?",
                "Give me a full workspace summary",
            ],
            meta: {
                providerLabel: "Deterministic REST snapshot",
                llmEnabled: false,
                taskCount: snapshot.tasks.length,
                timeEntryCount: snapshot.weekTimeEntries.length,
                windowLabel: `${format(snapshot.weekStart, "MMM d")} - ${format(snapshot.weekEnd, "MMM d")}`,
            },
        };
    }

    if (intent === "blocked") {
        return {
            title: "Blocked work",
            summary: blockedTasks.length > 0
                ? `Found ${blockedTasks.length} blocked or waiting tasks.`
                : "No blocked or waiting tasks showed up in the current snapshot.",
            bullets: blockedTasks.length > 0
                ? blockedTasks.map((task) => `${task.name} is currently "${task.status?.status || "unknown"}" in ${task.list?.name || "No list"}.`)
                : [
                    "If the team still feels stuck, ask for overdue work or workload hotspots next.",
                ],
            suggestions: [
                "What is overdue right now?",
                "Summarize this week's logged time",
                "Who has the heaviest workload?",
            ],
            meta: {
                providerLabel: "Deterministic REST snapshot",
                llmEnabled: false,
                taskCount: snapshot.tasks.length,
                timeEntryCount: snapshot.weekTimeEntries.length,
                windowLabel: `${format(snapshot.weekStart, "MMM d")} - ${format(snapshot.weekEnd, "MMM d")}`,
            },
        };
    }

    if (intent === "time") {
        const totalHours = toHours(snapshot.weekTimeEntries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0));
        return {
            title: "This week's time",
            summary: `${totalHours} hours are logged between ${format(snapshot.weekStart, "MMM d")} and ${format(snapshot.weekEnd, "MMM d")}.`,
            bullets: topTimeUsers.length > 0
                ? topTimeUsers.map((entry) => `${entry.name} logged ${entry.hours} hours.`)
                : [
                    "No time entries are available for the current week yet.",
                ],
            suggestions: [
                "Who has the heaviest workload?",
                "What is overdue right now?",
                "Give me a workspace summary",
            ],
            meta: {
                providerLabel: "Deterministic REST snapshot",
                llmEnabled: false,
                taskCount: snapshot.tasks.length,
                timeEntryCount: snapshot.weekTimeEntries.length,
                windowLabel: `${format(snapshot.weekStart, "MMM d")} - ${format(snapshot.weekEnd, "MMM d")}`,
            },
        };
    }

    if (intent === "assignee") {
        return {
            title: "Workload snapshot",
            summary: topAssignees.length > 0
                ? "These assignees currently hold the most open work."
                : "No assignee workload data is available in the current snapshot.",
            bullets: topAssignees.length > 0
                ? topAssignees.map(([name, count]) => `${name} owns ${count} open tasks.`)
                : [
                    "Try the overview prompt if you want a broader summary.",
                ],
            suggestions: [
                "What is overdue right now?",
                "Summarize this week's logged time",
                "Which tasks are blocked?",
            ],
            meta: {
                providerLabel: "Deterministic REST snapshot",
                llmEnabled: false,
                taskCount: snapshot.tasks.length,
                timeEntryCount: snapshot.weekTimeEntries.length,
                windowLabel: `${format(snapshot.weekStart, "MMM d")} - ${format(snapshot.weekEnd, "MMM d")}`,
            },
        };
    }

    if (intent === "actions") {
        return {
            title: "Action workflow",
            summary: "This chat stays read-only and deterministic. Create and update actions should remain outside the product chat unless you explicitly build a separate server-side workflow for them.",
            bullets: [
                "Read-only answers come from the existing ClickUp REST client.",
                "No embedded LLM is used to answer these prompts.",
                "If you ever add write actions later, keep them as explicit backend operations rather than model-driven chat actions.",
            ],
            suggestions: [
                "Give me a workspace summary",
                "What is overdue right now?",
                "Who has the heaviest workload?",
            ],
            meta: {
                providerLabel: "Deterministic REST snapshot",
                llmEnabled: false,
                taskCount: snapshot.tasks.length,
                timeEntryCount: snapshot.weekTimeEntries.length,
                windowLabel: `${format(snapshot.weekStart, "MMM d")} - ${format(snapshot.weekEnd, "MMM d")}`,
            },
        };
    }

    return buildOverviewReply(snapshot);
}

export async function askClickUpAssistant(question: string): Promise<ClickUpAssistantReply> {
    const snapshot = await getWorkspaceSnapshot();
    const restReply = question ? buildIntentReply(question, snapshot) : buildOverviewReply(snapshot);
    return {
        ...restReply,
        mode: "rules",
        status: "ready",
    };
}

export function getClickUpAssistantPrimer() {
    const since = format(subDays(new Date(), 7), "MMM d");

    return {
        providerLabel: "Deterministic REST snapshot",
        helperText: `This chat does not call a language model. It uses rule-based logic over the current ClickUp workspace snapshot and recent time entries since ${since}.`,
        suggestions: [
            "Give me a workspace summary",
            "What is overdue right now?",
            "Who has the heaviest workload?",
        ],
    };
}
