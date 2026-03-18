"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sidebar, FolderWithLists } from "@/components/Sidebar";
import { EditableTaskBoard } from "@/components/EditableTaskBoard";
import { CommandCenter } from "@/components/CommandCenter";
import { ProjectsBacklogGrowth } from "@/components/ProjectsBacklogGrowth";
import { CapacityGrid } from "@/components/CapacityGrid";
import { ConsultantUtilization } from "@/components/ConsultantUtilization";
import { Trends } from "@/components/Trends";
import { CapacityTrends } from "@/components/CapacityTrends";
import { CapacityGridPayload, EditableTaskBillableRollupRecord, TaskSidebarStructureRecord } from "@/app/actions";
import { ClickUpTask, TimeEntry, PROFESSIONAL_SERVICES_SPACE_ID } from "@/lib/clickup";
import { Rocket } from "lucide-react";

interface DashboardClientProps {
    initialTasks: ClickUpTask[];
    initialFolders: FolderWithLists[];
    initialTimeEntries: TimeEntry[];
    isError: boolean;
    weekStartStr: string;
    dbConfig: any; // Mapped Prisma payload
    initialTab?: string;
    initialSelectedListId?: string | null;
    initialSelectedFolderId?: string | null;
    initialAssigneeFilter?: string | null;
    initialTaskBillableRollups?: EditableTaskBillableRollupRecord[];
    initialSidebarStructure?: TaskSidebarStructureRecord;
}

const EMPTY_CAPACITY_GRID: CapacityGridPayload = { resources: [], rows: [] };
const VALID_TABS = new Set(["issues", "editable-tasks", "command-center", "trends", "capacity-trends", "consultant-utilization", "capacity-grid", "backlog-growth"]);
const normalizeTab = (tab?: string) => (tab && VALID_TABS.has(tab) ? tab : "command-center");

function pickPreferredConsultantName(currentName: string, incomingName: string) {
    const current = String(currentName || "").trim();
    const incoming = String(incomingName || "").trim();
    if (!current) return incoming;
    if (!incoming) return current;
    const currentTokens = current.split(/\s+/).filter(Boolean).length;
    const incomingTokens = incoming.split(/\s+/).filter(Boolean).length;
    if (incomingTokens > currentTokens) return incoming;
    if (incomingTokens === currentTokens && incoming.length > current.length) return incoming;
    return current;
}

export function DashboardClient({
    initialTasks,
    initialFolders,
    initialTimeEntries,
    isError,
    weekStartStr,
    dbConfig,
    initialTab,
    initialSelectedListId = null,
    initialSelectedFolderId = null,
    initialAssigneeFilter = null,
    initialTaskBillableRollups = [],
    initialSidebarStructure = { folders: [], boards: [], hiddenBoardIds: [] },
}: DashboardClientProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const selectedListId = initialSelectedListId;
    const selectedFolderId = initialSelectedFolderId;
    const selectedAssigneeFilter = initialAssigneeFilter;
    const activeTab = normalizeTab(initialTab);
    const [capacityGridState, setCapacityGridState] = useState<CapacityGridPayload>(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    const resolvedActiveTab = normalizeTab(activeTab);

    useEffect(() => {
        setCapacityGridState(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    }, [weekStartStr, dbConfig?.capacityGridConfig]);

    const navigateWithState = useCallback((
        nextTab: string,
        nextListId: string | null,
        nextFolderId: string | null,
        nextAssignee: string | null = selectedAssigneeFilter
    ) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("week", weekStartStr);
        params.set("tab", normalizeTab(nextTab));
        if (nextAssignee) {
            params.set("assignee", nextAssignee);
        } else {
            params.delete("assignee");
        }
        if (nextListId) {
            params.set("listId", nextListId);
            params.delete("folderId");
        } else if (nextFolderId) {
            params.set("folderId", nextFolderId);
            params.delete("listId");
        } else {
            params.delete("listId");
            params.delete("folderId");
        }
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
    }, [pathname, router, searchParams, selectedAssigneeFilter, weekStartStr]);

    // Filter tasks down strictly to the Professional Services space
    const proServicesTasks = useMemo(() => {
        return initialTasks.filter(t => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID);
    }, [initialTasks]);

    const availableFolders = useMemo(() => {
        const shouldExcludeList = (name: string) => /user\s*guide/i.test(name);
        const hiddenBoardIds = new Set((initialSidebarStructure?.hiddenBoardIds ?? []).map((id) => String(id)));
        const localBoardsByFolderId = new Map<string, Array<{ id: string; name: string; source: "local" }>>();
        (initialSidebarStructure?.boards ?? []).forEach((board) => {
            if (hiddenBoardIds.has(String(board.id))) return;
            const parentFolderId = String(board.parentFolderId ?? "");
            const current = localBoardsByFolderId.get(parentFolderId) ?? [];
            current.push({
                id: String(board.id),
                name: String(board.name),
                source: "local",
            });
            localBoardsByFolderId.set(parentFolderId, current);
        });

        if (initialFolders.length > 0) {
            const clickupFolders = initialFolders
                .map((folder) => ({
                    ...folder,
                    source: "clickup" as const,
                    lists: [
                        ...folder.lists
                            .filter((list) => !shouldExcludeList(list.name) && !hiddenBoardIds.has(String(list.id)))
                            .map((list) => ({
                            ...list,
                            source: "clickup" as const,
                        })),
                        ...(localBoardsByFolderId.get(folder.id) ?? []),
                    ],
                }))
                .filter((folder) => folder.lists.length > 0);

            const localFolders = (initialSidebarStructure?.folders ?? []).map((folder) => ({
                id: String(folder.id),
                name: String(folder.name),
                source: "local" as const,
                lists: localBoardsByFolderId.get(String(folder.id)) ?? [],
            }));

            return [...clickupFolders, ...localFolders];
        }

        const folderMap = new Map<string, { id: string, name: string, source: "clickup", lists: Map<string, { id: string, name: string, statusOrder: string[], source: "clickup" }> }>();
        proServicesTasks.forEach((task) => {
            if (!task.folder?.id || !task.folder?.name) return;
            if (!folderMap.has(task.folder.id)) {
                folderMap.set(task.folder.id, {
                    id: task.folder.id,
                    name: task.folder.name,
                    source: "clickup",
                    lists: new Map()
                });
            }

                if (task.list?.id && task.list?.name) {
                    if (shouldExcludeList(task.list.name) || hiddenBoardIds.has(String(task.list.id))) return;
                    folderMap.get(task.folder.id)!.lists.set(task.list.id, {
                        id: task.list.id,
                        name: task.list.name,
                    statusOrder: [],
                    source: "clickup",
                });
            }
        });

        const clickupFolders = Array.from(folderMap.values()).map((folder) => ({
            id: folder.id,
            name: folder.name,
            source: folder.source,
            lists: [
                ...Array.from(folder.lists.values()),
                ...(localBoardsByFolderId.get(folder.id) ?? []),
            ]
        }));
        const localFolders = (initialSidebarStructure?.folders ?? []).map((folder) => ({
            id: String(folder.id),
            name: String(folder.name),
            source: "local" as const,
            lists: localBoardsByFolderId.get(String(folder.id)) ?? [],
        }));

        return [...clickupFolders, ...localFolders];
    }, [initialFolders, initialSidebarStructure, proServicesTasks]);

    const handleListSelect = (listId: string | null) => {
        const nextTab = "issues";
        navigateWithState(nextTab, listId, null);
    };

    const handleFolderSelect = (folderId: string | null) => {
        const nextTab = "issues";
        navigateWithState(nextTab, null, folderId);
    };

    const handleTabSelect = (tab: string) => {
        const nextTab = VALID_TABS.has(tab) ? tab : "command-center";
        navigateWithState(nextTab, selectedListId, selectedFolderId);
    };

    // 3. Slice tasks based on active Client (List) or Team (Folder)
    const visibleTasks = useMemo(() => {
        if (selectedListId) {
            return proServicesTasks.filter(t => t.list?.id === selectedListId);
        }
        if (selectedFolderId) {
            return proServicesTasks.filter(t => t.folder?.id === selectedFolderId);
        }
        return proServicesTasks;
    }, [proServicesTasks, selectedListId, selectedFolderId]);

    const projectOptions = useMemo(() => {
        return availableFolders
            .flatMap((folder) => folder.lists.map((list) => ({ id: list.id, name: list.name })))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [availableFolders]);

    const editableTaskScope = useMemo(() => {
        if (selectedListId) {
            for (const folder of availableFolders) {
                const list = folder.lists.find((item) => item.id === selectedListId);
                if (list) {
                    return {
                        type: "list",
                        id: selectedListId,
                        name: list.name,
                    } as const;
                }
            }
            return {
                type: "list",
                id: selectedListId,
                name: selectedListId,
            } as const;
        }

        if (selectedFolderId) {
            const folder = availableFolders.find((item) => item.id === selectedFolderId);
            return {
                type: "folder",
                id: selectedFolderId,
                name: folder?.name ?? selectedFolderId,
            } as const;
        }

        return {
            type: "all",
            id: "all",
            name: "All Clients",
        } as const;
    }, [availableFolders, selectedFolderId, selectedListId]);

    const consultantsFromTasks = useMemo(() => {
        const byId = new Map<number, string>();
        proServicesTasks.forEach((task) => {
            if (!Array.isArray(task.assignees)) return;
            task.assignees.forEach((a: any) => {
                const id = Number(a?.id ?? 0);
                if (!id) return;
                const name = String(a?.username ?? "").trim();
                if (!name) return;
                const current = byId.get(id) || "";
                byId.set(id, pickPreferredConsultantName(current, name));
            });
        });
        return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
    }, [proServicesTasks]);

    const consultantsForRoster = useMemo(() => {
        const gridResources = Array.isArray(capacityGridState?.resources) ? capacityGridState.resources : [];
        if (gridResources.length > 0) {
            return gridResources
                .map((resource: any, idx: number) => ({
                    id: Number(resource?.consultantId ?? -(idx + 1)),
                    name: String(resource?.name ?? "").trim(),
                    removed: Boolean(resource?.removed ?? false),
                }))
                .filter((consultant) => consultant.name.length > 0);
        }
        return consultantsFromTasks;
    }, [capacityGridState?.resources, consultantsFromTasks]);

    const activeConsultantNames = useMemo(
        () => consultantsForRoster
            .filter((consultant) => !Boolean((consultant as any).removed))
            .map((consultant) => consultant.name)
            .filter((name) => name.length > 0)
            .sort((a, b) => a.localeCompare(b)),
        [consultantsForRoster]
    );

    const baseConsultantConfigsById = useMemo(() => {
        const byId = new Map<number, { maxCapacity: number; billableCapacity: number; notes: string }>();
        consultantsForRoster.forEach((consultant) => {
            byId.set(consultant.id, { maxCapacity: 40, billableCapacity: 40, notes: "" });
        });

        const consultantConfigs = Array.isArray(dbConfig?.consultantConfigs) ? dbConfig.consultantConfigs : [];
        consultantConfigs.forEach((cfg: any) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            const existing = byId.get(consultantId) || { maxCapacity: 40, billableCapacity: 40, notes: "" };
            byId.set(consultantId, {
                maxCapacity: Number(cfg?.maxCapacity ?? existing.maxCapacity ?? 40),
                billableCapacity: Number(cfg?.billableCapacity ?? existing.billableCapacity ?? 40),
                notes: String(cfg?.notes ?? existing.notes ?? ""),
            });
        });

        const result: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }> = {};
        byId.forEach((value, consultantId) => {
            result[consultantId] = value;
        });
        return result;
    }, [consultantsForRoster, dbConfig?.consultantConfigs]);

    const [consultantConfigsState, setConsultantConfigsState] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(baseConsultantConfigsById);

    useEffect(() => {
        setConsultantConfigsState(baseConsultantConfigsById);
    }, [weekStartStr, baseConsultantConfigsById]);

    const consultantConfigsForCommandCenter = useMemo(() => {
        return Object.entries(consultantConfigsState).map(([consultantId, cfg]) => ({
            consultantId: Number(consultantId),
            maxCapacity: Number(cfg.maxCapacity ?? 40),
            billableCapacity: Number(cfg.billableCapacity ?? 40),
            notes: String(cfg.notes ?? ""),
        }));
    }, [consultantConfigsState]);

    const previousConsultantConfigsForCommandCenter = useMemo(() => {
        const byId = new Map<number, { maxCapacity: number; billableCapacity: number; notes: string }>();
        consultantsFromTasks.forEach((consultant) => {
            byId.set(consultant.id, { maxCapacity: 40, billableCapacity: 40, notes: "" });
        });

        const prevRows = Array.isArray(dbConfig?.previousConsultantConfigs) ? dbConfig.previousConsultantConfigs : [];
        prevRows.forEach((cfg: any) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            const existing = byId.get(consultantId) || { maxCapacity: 40, billableCapacity: 40, notes: "" };
            byId.set(consultantId, {
                maxCapacity: Number(cfg?.maxCapacity ?? existing.maxCapacity ?? 40),
                billableCapacity: Number(cfg?.billableCapacity ?? existing.billableCapacity ?? 40),
                notes: String(cfg?.notes ?? existing.notes ?? ""),
            });
        });

        return Array.from(byId.entries()).map(([consultantId, cfg]) => ({
            consultantId,
            maxCapacity: Number(cfg.maxCapacity ?? 40),
            billableCapacity: Number(cfg.billableCapacity ?? 40),
            notes: String(cfg.notes ?? ""),
        }));
    }, [consultantsFromTasks, dbConfig?.previousConsultantConfigs]);

    const mergedDbConfig = useMemo(() => ({
        ...dbConfig,
        capacityGridConfig: capacityGridState,
        consultantConfigs: consultantConfigsForCommandCenter,
        previousConsultantConfigs: previousConsultantConfigsForCommandCenter,
    }), [dbConfig, capacityGridState, consultantConfigsForCommandCenter, previousConsultantConfigsForCommandCenter]);

    const handleConsultantConfigChange = (
        consultantId: number,
        patch: Partial<{ maxCapacity: number; billableCapacity: number; notes: string }>
    ) => {
        setConsultantConfigsState((prev) => ({
            ...prev,
            [consultantId]: {
                ...(prev[consultantId] || { maxCapacity: 40, billableCapacity: 40, notes: "" }),
                ...patch,
            },
        }));
    };

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-sm selection:bg-primary/30 selection:text-white">
            <Sidebar
                folders={availableFolders}
                selectedListId={selectedListId}
                selectedFolderId={selectedFolderId}
                activeTab={resolvedActiveTab}
                weekStr={weekStartStr}
                assigneeFilter={selectedAssigneeFilter}
                onSelectList={handleListSelect}
                onSelectFolder={handleFolderSelect}
                onSelectTab={handleTabSelect}
                teamsLabel="Clients"
            />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                {/* Header Bar */}
                <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background/90 backdrop-blur-md z-20">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded overflow-hidden">
                            <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-500 rounded-sm" />
                        </div>
                        <h1 className="font-semibold text-white">Mission Engine</h1>
                        <span className="text-text-muted text-xs bg-surface-hover px-2 py-0.5 rounded-full border border-border">
                            Prod
                        </span>
                    </div>

                    <div className="flex items-center gap-5">
                        <div className="lucid-interactive flex items-center gap-2 cursor-pointer border border-border/50">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs">System Online</span>
                        </div>
                    </div>
                </header>

                {isError && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 mx-6 mt-6 rounded-lg text-sm flex items-center gap-2">
                        <Rocket className="w-4 h-4" />
                        <span>Connection Error: ClickUp API Key missing or invalid. Displaying empty state.</span>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 custom-scrollbar flex flex-col relative">
                    {/* Conditional Rendering based on activeTab */}
                    {resolvedActiveTab === "issues" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <EditableTaskBoard
                                activeWeekStr={weekStartStr}
                                tasks={proServicesTasks}
                                scopeType={editableTaskScope.type}
                                scopeId={editableTaskScope.id}
                                scopeName={editableTaskScope.name}
                                assigneeOptions={activeConsultantNames}
                                initialAssigneeFilter={selectedAssigneeFilter}
                                tabId="issues"
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "command-center" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CommandCenter
                                tasks={proServicesTasks}
                                timeEntries={initialTimeEntries}
                                activeWeekStr={weekStartStr}
                                dbConfig={mergedDbConfig}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "trends" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <Trends
                                activeWeekStr={weekStartStr}
                                weeklyTrend={Array.isArray(mergedDbConfig?.weeklyTrend) ? mergedDbConfig.weeklyTrend : []}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "capacity-trends" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CapacityTrends
                                activeWeekStr={weekStartStr}
                                consultants={consultantsFromTasks}
                                consultantConfigsForYear={Array.isArray(mergedDbConfig?.consultantConfigsForYear) ? mergedDbConfig.consultantConfigsForYear : []}
                                consultantConfigsCurrentWeek={Array.isArray(mergedDbConfig?.consultantConfigs) ? mergedDbConfig.consultantConfigs : []}
                                capacityGridConfigsForYear={Array.isArray(mergedDbConfig?.capacityGridConfigsForYear) ? mergedDbConfig.capacityGridConfigsForYear : []}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "capacity-grid" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CapacityGrid
                                activeWeekStr={weekStartStr}
                                initialGrid={capacityGridState}
                                onGridChange={setCapacityGridState}
                                consultants={consultantsForRoster}
                                consultantConfigsById={consultantConfigsState}
                                tasks={proServicesTasks}
                                folders={availableFolders}
                                activeAssigneeFilter={selectedAssigneeFilter}
                                billableRollups={initialTaskBillableRollups}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "consultant-utilization" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ConsultantUtilization
                                activeWeekStr={weekStartStr}
                                consultants={consultantsForRoster}
                                consultantConfigsById={consultantConfigsState}
                                capacityGrid={capacityGridState}
                                onConsultantConfigChange={handleConsultantConfigChange}
                                onCapacityGridChange={setCapacityGridState}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "backlog-growth" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ProjectsBacklogGrowth
                                tasks={proServicesTasks}
                                projectOptions={projectOptions}
                            />
                        </section>
                    )}
                </div>
            </main>
        </div>
    );
}
