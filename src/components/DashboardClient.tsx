"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sidebar, FolderWithLists } from "@/components/Sidebar";
import { EditableTaskBoard } from "@/components/EditableTaskBoard";
import { CommandCenter } from "@/components/CommandCenter";
import { ProjectsBacklogGrowth } from "@/components/ProjectsBacklogGrowth";
import { CapacityGrid } from "@/components/CapacityGrid";
import { ConsultantUtilization } from "@/components/ConsultantUtilization";
import { Timesheets } from "@/components/Timesheets";
import { ClientSetup } from "@/components/ClientSetup";
import { Trends } from "@/components/Trends";
import { CapacityTrends } from "@/components/CapacityTrends";
import { CapacityGridPayload, EditableTaskBillableRollupRecord, TaskSidebarStructureRecord, loadDashboardWeekData } from "@/app/actions";
import { ClickUpTask, TimeEntry, PROFESSIONAL_SERVICES_SPACE_ID } from "@/lib/clickup";
import { Rocket } from "lucide-react";
import { MissionEngineMark } from "@/components/BrandMarks";

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

type ConsultantDirectoryEntry = {
    id: number;
    name: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    source?: string;
};

type ClientOption = {
    id: string;
    name: string;
};

type DashboardExtraParams = Record<string, string | null | undefined>;

const EMPTY_CAPACITY_GRID: CapacityGridPayload = { resources: [], rows: [] };
const VALID_TABS = new Set(["issues", "editable-tasks", "command-center", "trends", "capacity-trends", "consultant-utilization", "timesheets", "capacity-grid", "client-setup", "backlog-growth"]);
const normalizeTab = (tab?: string) => (tab && VALID_TABS.has(tab) ? tab : "command-center");
type DashboardWeekSnapshot = Awaited<ReturnType<typeof loadDashboardWeekData>>;

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

function normalizeConsultantNameKey(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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
    initialSidebarStructure = { folders: [], boards: [], placements: [], folderOverrides: [], hiddenFolderIds: [], hiddenBoardIds: [] },
}: DashboardClientProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isWeekLoading, setIsWeekLoading] = useState(false);
    const [activeWeekStrState, setActiveWeekStrState] = useState(weekStartStr);
    const [activeTabState, setActiveTabState] = useState(normalizeTab(initialTab));
    const [selectedListIdState, setSelectedListIdState] = useState<string | null>(initialSelectedListId);
    const [selectedFolderIdState, setSelectedFolderIdState] = useState<string | null>(initialSelectedFolderId);
    const [selectedAssigneeFilterState, setSelectedAssigneeFilterState] = useState<string | null>(initialAssigneeFilter);
    const [dashboardConfigState, setDashboardConfigState] = useState(dbConfig);
    const [taskBillableRollupsState, setTaskBillableRollupsState] = useState<EditableTaskBillableRollupRecord[]>(initialTaskBillableRollups);
    const [capacityGridState, setCapacityGridState] = useState<CapacityGridPayload>(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    const weekRequestIdRef = useRef(0);
    const weekSnapshotCacheRef = useRef<Map<string, DashboardWeekSnapshot>>(new Map());
    const weekPrefetchInFlightRef = useRef<Set<string>>(new Set());
    const resolvedActiveTab = normalizeTab(activeTabState);

    useEffect(() => {
        setIsWeekLoading(false);
        setActiveWeekStrState(weekStartStr);
        setActiveTabState(normalizeTab(initialTab));
        setSelectedListIdState(initialSelectedListId);
        setSelectedFolderIdState(initialSelectedFolderId);
        setSelectedAssigneeFilterState(initialAssigneeFilter);
        setDashboardConfigState(dbConfig);
        setTaskBillableRollupsState(initialTaskBillableRollups);
        setCapacityGridState(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    }, [
        dbConfig,
        initialAssigneeFilter,
        initialSelectedFolderId,
        initialSelectedListId,
        initialTab,
        initialTaskBillableRollups,
        weekStartStr,
    ]);

    const buildDashboardHref = useCallback((
        nextWeek: string,
        nextTab: string,
        nextListId: string | null,
        nextFolderId: string | null,
        nextAssignee: string | null = selectedAssigneeFilterState,
        extraParams: DashboardExtraParams = {}
    ) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("week", nextWeek);
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
        params.delete("returnTo");
        Object.entries(extraParams).forEach(([key, value]) => {
            const nextValue = String(value ?? "").trim();
            if (nextValue.length > 0) {
                params.set(key, nextValue);
            } else {
                params.delete(key);
            }
        });
        return `${pathname}?${params.toString()}`;
    }, [pathname, searchParams, selectedAssigneeFilterState]);

    const syncBrowserUrl = useCallback((href: string) => {
        if (typeof window === "undefined") return;
        window.history.pushState({}, "", href);
    }, []);

    const navigateWithState = useCallback((
        nextTab: string,
        nextListId: string | null,
        nextFolderId: string | null,
        nextAssignee: string | null = selectedAssigneeFilterState,
        extraParams: DashboardExtraParams = {}
    ) => {
        const normalizedTab = normalizeTab(nextTab);
        setActiveTabState(normalizedTab);
        setSelectedListIdState(nextListId);
        setSelectedFolderIdState(nextFolderId);
        setSelectedAssigneeFilterState(nextAssignee);
        syncBrowserUrl(buildDashboardHref(activeWeekStrState, normalizedTab, nextListId, nextFolderId, nextAssignee, extraParams));
    }, [activeWeekStrState, buildDashboardHref, selectedAssigneeFilterState, syncBrowserUrl]);

    // Filter tasks down strictly to the Professional Services space
    const proServicesTasks = useMemo(() => {
        return initialTasks.filter(t => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID);
    }, [initialTasks]);

    const clientOptions = useMemo<ClientOption[]>(() => {
        const rows = Array.isArray(dashboardConfigState?.clientDirectory) ? dashboardConfigState.clientDirectory : [];
        const byId = new Map<string, ClientOption>();
        rows.forEach((row: any) => {
            if (row?.isActive === false) return;
            const id = String(row?.id ?? "").trim();
            const name = String(row?.name ?? row?.id ?? "").trim();
            if (!id || !name) return;
            byId.set(id, { id, name });
        });
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [dashboardConfigState?.clientDirectory]);

    const availableFolders = useMemo(() => {
        const shouldExcludeList = (name: string) => /user\s*guide/i.test(name);
        const hiddenFolderIds = new Set((initialSidebarStructure?.hiddenFolderIds ?? []).map((id) => String(id)));
        const hiddenBoardIds = new Set((initialSidebarStructure?.hiddenBoardIds ?? []).map((id) => String(id)));
        const folderOverrideMap = new Map(
            (initialSidebarStructure?.folderOverrides ?? []).map((override) => [
                `${override.source}:${override.folderId}`,
                override,
            ])
        );
        const placementMap = new Map(
            (initialSidebarStructure?.placements ?? []).map((placement) => [
                `${placement.source}:${placement.boardId}`,
                placement,
            ])
        );
        const normalizedClientCandidates = clientOptions.map((client) => ({
            ...client,
            normalizedId: normalizeConsultantNameKey(client.id),
            normalizedName: normalizeConsultantNameKey(client.name),
        }));

        const inferClientFromBoardName = (boardName: string): ClientOption | null => {
            const normalizedBoardName = normalizeConsultantNameKey(boardName);
            if (!normalizedBoardName) return null;
            let bestMatch: { id: string; name: string; score: number } | null = null;
            for (const client of normalizedClientCandidates) {
                const idScore = client.normalizedId && normalizedBoardName.includes(client.normalizedId) ? client.normalizedId.length + 100 : 0;
                const nameScore = client.normalizedName && normalizedBoardName.includes(client.normalizedName) ? client.normalizedName.length : 0;
                const score = Math.max(idScore, nameScore);
                if (score <= 0) continue;
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { id: client.id, name: client.name, score };
                }
            }
            return bestMatch ? { id: bestMatch.id, name: bestMatch.name } : null;
        };

        const folderCatalog = new Map<string, { id: string; name: string; source: "clickup" | "local" }>();
        initialFolders.forEach((folder) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            const override = folderOverrideMap.get(`clickup:${String(folder.id)}`);
            folderCatalog.set(String(folder.id), {
                id: String(folder.id),
                name: String(override?.name ?? folder.name),
                source: "clickup",
            });
        });
        (initialSidebarStructure?.folders ?? []).forEach((folder) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            const override = folderOverrideMap.get(`local:${String(folder.id)}`);
            folderCatalog.set(String(folder.id), {
                id: String(folder.id),
                name: String(override?.name ?? folder.name),
                source: "local",
            });
        });

        // Reconstruct missing folders from placements when ClickUp API is unavailable.
        // First pass: group placements by parentFolderId to derive the best folder name.
        const placementsByFolder = new Map<string, Array<{ boardName: string | null; clientName: string | null }>>();
        (initialSidebarStructure?.placements ?? []).forEach((placement) => {
            const folderId = String(placement.parentFolderId ?? "");
            if (!folderId) return;
            const existing = placementsByFolder.get(folderId) ?? [];
            existing.push({ boardName: placement.boardName ?? null, clientName: placement.clientName ?? null });
            placementsByFolder.set(folderId, existing);
        });
        placementsByFolder.forEach((items, folderId) => {
            if (folderCatalog.has(folderId) || hiddenFolderIds.has(folderId)) return;
            const override = folderOverrideMap.get(`clickup:${folderId}`) ?? folderOverrideMap.get(`local:${folderId}`);
            let derivedName = override?.name ?? null;
            if (!derivedName) {
                // Derive name from client names: if all share a prefix, use it; otherwise list unique clients
                const clientNames = items.map((p) => p.clientName).filter(Boolean) as string[];
                const uniqueClients = Array.from(new Set(clientNames));
                if (uniqueClients.length === 1) {
                    derivedName = uniqueClients[0];
                } else if (uniqueClients.length > 0 && uniqueClients.length <= 3) {
                    derivedName = uniqueClients.join(", ");
                } else if (uniqueClients.length > 3) {
                    derivedName = `${uniqueClients.slice(0, 3).join(", ")} +${uniqueClients.length - 3}`;
                } else {
                    // Fall back to first board name
                    const firstBoard = items.find((p) => p.boardName)?.boardName;
                    derivedName = firstBoard ?? `Folder ${folderId}`;
                }
            }
            folderCatalog.set(folderId, {
                id: folderId,
                name: String(derivedName),
                source: "clickup",
            });
        });

        const boardBuckets = new Map<
            string,
            Array<{
                id: string;
                name: string;
                source: "clickup" | "local";
                statusOrder?: string[];
                clientId?: string | null;
                clientName?: string | null;
                sortOrder: number;
            }>
        >();

        const pushBoard = (board: {
            id: string;
            name: string;
            source: "clickup" | "local";
            defaultFolderId: string;
            defaultOrder: number;
            statusOrder?: string[];
        }) => {
            const placement = placementMap.get(`${board.source}:${board.id}`);
            const resolvedBoardName = String(placement?.boardName ?? board.name);
            const linkedClient = placement?.clientId && placement?.clientName
                ? { id: String(placement.clientId), name: String(placement.clientName) }
                : inferClientFromBoardName(resolvedBoardName);
            const targetFolderId = String(placement?.parentFolderId ?? board.defaultFolderId);
            if (!targetFolderId) return;
            const bucket = boardBuckets.get(targetFolderId) ?? [];
            bucket.push({
                id: board.id,
                name: resolvedBoardName,
                source: board.source,
                statusOrder: board.statusOrder,
                clientId: linkedClient?.id ?? null,
                clientName: linkedClient?.name ?? null,
                sortOrder: Number(placement?.orderIndex ?? board.defaultOrder),
            });
            boardBuckets.set(targetFolderId, bucket);
        };

        initialFolders.forEach((folder) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            folder.lists
                .filter((list) => !shouldExcludeList(list.name) && !hiddenBoardIds.has(String(list.id)))
                .forEach((list, index) => {
                    pushBoard({
                        id: String(list.id),
                        name: String(list.name),
                        source: "clickup",
                        defaultFolderId: String(folder.id),
                        defaultOrder: index,
                        statusOrder: list.statusOrder,
                    });
                });
        });

        (initialSidebarStructure?.boards ?? [])
            .filter((board) => !hiddenBoardIds.has(String(board.id)))
            .forEach((board) => {
                if (hiddenFolderIds.has(String(board.parentFolderId ?? ""))) return;
                pushBoard({
                    id: String(board.id),
                    name: String(board.name),
                    source: "local",
                    defaultFolderId: String(board.parentFolderId ?? ""),
                    defaultOrder: 1000 + Number(board.orderIndex ?? 0),
                });
            });

        // Push boards from placements when ClickUp API boards are unavailable
        (initialSidebarStructure?.placements ?? []).forEach((placement) => {
            const boardId = String(placement.boardId ?? "");
            const folderId = String(placement.parentFolderId ?? "");
            if (!boardId || !folderId || hiddenBoardIds.has(boardId) || hiddenFolderIds.has(folderId)) return;
            const existingBucket = boardBuckets.get(folderId) ?? [];
            if (existingBucket.some((b) => b.id === boardId)) return;
            pushBoard({
                id: boardId,
                name: String(placement.boardName ?? boardId),
                source: placement.source === "local" ? "local" : "clickup",
                defaultFolderId: folderId,
                defaultOrder: Number(placement.orderIndex ?? 0),
            });
        });

        const buildFolder = (folderId: string): FolderWithLists | null => {
            const folder = folderCatalog.get(folderId);
            if (!folder) return null;
            const lists = (boardBuckets.get(folderId) ?? [])
                .sort((a, b) => {
                    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                    return a.name.localeCompare(b.name);
                })
                .map(({ sortOrder, ...list }) => list);
            if (lists.length === 0) return null;
            return {
                id: folder.id,
                name: folder.name,
                source: folder.source,
                lists,
            };
        };

        if (initialFolders.length > 0) {
            const includedFolderIds = new Set<string>();
            const clickupFolders = initialFolders
                .filter((folder) => !hiddenFolderIds.has(String(folder.id)))
                .map((folder) => buildFolder(String(folder.id)))
                .filter((folder): folder is FolderWithLists => {
                    if (!folder) return false;
                    includedFolderIds.add(folder.id);
                    return true;
                });
            const localFolders = (initialSidebarStructure?.folders ?? [])
                .filter((folder) => !hiddenFolderIds.has(String(folder.id)))
                .map((folder) => buildFolder(String(folder.id)))
                .filter((folder): folder is FolderWithLists => {
                    if (!folder) return false;
                    includedFolderIds.add(folder.id);
                    return true;
                });
            // Build folders that exist only in placements (not in ClickUp API or local DB folders)
            const placementFolders = Array.from(folderCatalog.keys())
                .filter((folderId) => !includedFolderIds.has(folderId))
                .map((folderId) => buildFolder(folderId))
                .filter((folder): folder is FolderWithLists => folder !== null);

            return [...clickupFolders, ...localFolders, ...placementFolders];
        }

        const folderMap = new Map<string, { id: string, name: string, source: "clickup", lists: Map<string, { id: string, name: string, statusOrder: string[], source: "clickup" }> }>();
        proServicesTasks.forEach((task) => {
            if (!task.folder?.id || !task.folder?.name) return;
            if (hiddenFolderIds.has(String(task.folder.id))) return;
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

        Array.from(folderMap.values()).forEach((folder) => {
            Array.from(folder.lists.values()).forEach((list, index) => {
                pushBoard({
                    id: String(list.id),
                    name: String(list.name),
                    source: "clickup",
                    defaultFolderId: String(folder.id),
                    defaultOrder: index,
                    statusOrder: list.statusOrder,
                });
            });
        });

        const includedFolderIds = new Set<string>();
        const clickupFolders = Array.from(folderMap.values())
            .map((folder) => buildFolder(String(folder.id)))
            .filter((folder): folder is FolderWithLists => {
                if (!folder) return false;
                includedFolderIds.add(folder.id);
                return true;
            });
        const localFolders = (initialSidebarStructure?.folders ?? [])
            .map((folder) => buildFolder(String(folder.id)))
            .filter((folder): folder is FolderWithLists => {
                if (!folder) return false;
                includedFolderIds.add(folder.id);
                return true;
            });
        // Build folders that exist only in placements (not in ClickUp task data or local DB folders)
        const placementFolders = Array.from(folderCatalog.keys())
            .filter((folderId) => !includedFolderIds.has(folderId))
            .map((folderId) => buildFolder(folderId))
            .filter((folder): folder is FolderWithLists => folder !== null);

        return [...clickupFolders, ...localFolders, ...placementFolders];
    }, [clientOptions, initialFolders, initialSidebarStructure, proServicesTasks]);

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
        navigateWithState(nextTab, selectedListIdState, selectedFolderIdState);
    };

    const handleAssigneeFilterChange = useCallback((nextAssignee: string | null) => {
        navigateWithState("issues", selectedListIdState, selectedFolderIdState, nextAssignee);
    }, [navigateWithState, selectedFolderIdState, selectedListIdState]);

    const handleTimesheetAssigneeFilterChange = useCallback((nextAssignee: string | null) => {
        navigateWithState("timesheets", selectedListIdState, selectedFolderIdState, nextAssignee);
    }, [navigateWithState, selectedFolderIdState, selectedListIdState]);

    const handleCapacityGridOpenTaskBoard = useCallback((
        target: {
            listId?: string | null;
            folderId?: string | null;
            assignee?: string | null;
            returnTo?: string | null;
        }
    ) => {
        navigateWithState(
            "issues",
            target.listId ?? null,
            target.folderId ?? null,
            target.assignee ?? null,
            { returnTo: target.returnTo ?? null }
        );
    }, [navigateWithState]);

    // 3. Slice tasks based on active Client (List) or Team (Folder)
    const visibleTasks = useMemo(() => {
        if (selectedListIdState) {
            return proServicesTasks.filter(t => t.list?.id === selectedListIdState);
        }
        if (selectedFolderIdState) {
            return proServicesTasks.filter(t => t.folder?.id === selectedFolderIdState);
        }
        return proServicesTasks;
    }, [proServicesTasks, selectedFolderIdState, selectedListIdState]);

    const projectOptions = useMemo(() => {
        return availableFolders
            .flatMap((folder) => folder.lists.map((list) => ({ id: list.id, name: list.name })))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [availableFolders]);

    const editableTaskScope = useMemo(() => {
        if (selectedListIdState) {
            for (const folder of availableFolders) {
                const list = folder.lists.find((item) => item.id === selectedListIdState);
                if (list) {
                    return {
                        type: "list",
                        id: selectedListIdState,
                        name: list.name,
                    } as const;
                }
            }
            return {
                type: "list",
                id: selectedListIdState,
                name: selectedListIdState,
            } as const;
        }

        if (selectedFolderIdState) {
            const folder = availableFolders.find((item) => item.id === selectedFolderIdState);
            return {
                type: "folder",
                id: selectedFolderIdState,
                name: folder?.name ?? selectedFolderIdState,
            } as const;
        }

        return {
            type: "all",
            id: "all",
            name: "All Clients",
        } as const;
    }, [availableFolders, selectedFolderIdState, selectedListIdState]);

    const selectedBoardMeta = useMemo(() => {
        if (!selectedListIdState) return null;
        for (const folder of availableFolders) {
            const list = folder.lists.find((item) => item.id === selectedListIdState);
            if (list) {
                return {
                    parentFolderId: String(folder.id),
                };
            }
        }
        return null;
    }, [availableFolders, selectedListIdState]);

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

    const consultantsFromDirectory = useMemo<ConsultantDirectoryEntry[]>(() => {
        const rows = Array.isArray(dashboardConfigState?.consultants) ? dashboardConfigState.consultants : [];
        return rows
            .map((consultant: any): ConsultantDirectoryEntry => ({
                id: Number(consultant?.id ?? 0),
                name: String(consultant?.name ?? consultant?.fullName ?? "").trim(),
                firstName: String(consultant?.firstName ?? "").trim(),
                lastName: String(consultant?.lastName ?? "").trim(),
                email: String(consultant?.email ?? "").trim(),
                source: String(consultant?.source ?? "manual"),
            }))
            .filter((consultant: ConsultantDirectoryEntry) => Number.isFinite(consultant.id) && consultant.id !== 0 && consultant.name.length > 0);
    }, [dashboardConfigState?.consultants]);

    const mergedConsultants = useMemo<ConsultantDirectoryEntry[]>(() => {
        const byId = new Map<number, ConsultantDirectoryEntry>();
        const idByNameKey = new Map<string, number>();

        consultantsFromDirectory.forEach((consultant: ConsultantDirectoryEntry) => {
            byId.set(consultant.id, consultant);
            const nameKey = normalizeConsultantNameKey(consultant.name);
            if (nameKey) idByNameKey.set(nameKey, consultant.id);
        });

        consultantsFromTasks.forEach((consultant: { id: number; name: string }) => {
            const nameKey = normalizeConsultantNameKey(consultant.name);
            const existing = byId.get(consultant.id) || byId.get(idByNameKey.get(nameKey) || 0);
            if (!existing) {
                return;
            }
            byId.set(existing.id, {
                ...existing,
                name: pickPreferredConsultantName(existing.name, consultant.name),
            });
            if (nameKey) idByNameKey.set(nameKey, existing.id);
        });

        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [consultantsFromDirectory, consultantsFromTasks]);

    const consultantsForRoster = useMemo(() => {
        const gridResources = Array.isArray(capacityGridState?.resources) ? capacityGridState.resources : [];
        const provisionedIds = new Set(mergedConsultants.map((consultant) => consultant.id));
        if (gridResources.length > 0) {
            return gridResources
                .map((resource: any, idx: number) => ({
                    id: Number(resource?.consultantId ?? -(idx + 1)),
                    name: String(resource?.name ?? "").trim(),
                    removed: Boolean(resource?.removed ?? false),
                }))
                .filter((consultant) => {
                    if (consultant.removed) return true;
                    return provisionedIds.has(consultant.id);
                })
                .filter((consultant) => consultant.name.length > 0);
        }
        return mergedConsultants;
    }, [capacityGridState?.resources, mergedConsultants]);

    const activeConsultantNames = useMemo(
        () => consultantsForRoster
            .filter((consultant) => !Boolean((consultant as any).removed))
            .map((consultant) => consultant.name)
            .filter((name) => name.length > 0)
            .sort((a, b) => a.localeCompare(b)),
        [consultantsForRoster]
    );

    const rosterCacheSignature = useMemo(
        () => consultantsForRoster
            .filter((consultant) => !Boolean((consultant as any).removed))
            .map((consultant) => `${consultant.id}:${consultant.name}`)
            .sort()
            .join("|"),
        [consultantsForRoster]
    );

    const getWeekCacheKey = useCallback((week: string, rosterSignature: string = rosterCacheSignature) => {
        return `${week}::${rosterSignature}`;
    }, [rosterCacheSignature]);

    const applyWeekSnapshot = useCallback((week: string, snapshot: DashboardWeekSnapshot) => {
        setDashboardConfigState((prev: any) => {
            const currentRows = Array.isArray(prev?.capacityGridConfigsForYear) ? prev.capacityGridConfigsForYear : [];
            const nextCapacityGridConfigsForYear = currentRows
                .filter((row: any) => String(row?.week ?? "") !== week)
                .concat([{ week, payload: snapshot.capacityGridConfig }])
                .sort((a: any, b: any) => String(a?.week ?? "").localeCompare(String(b?.week ?? "")));

            return {
                ...prev,
                weekConfig: snapshot.weekConfig,
                leadConfigs: snapshot.leadConfigs,
                clientConfigs: snapshot.clientConfigs,
                clientDirectory: snapshot.clientDirectory,
                consultantConfigs: snapshot.consultantConfigs,
                previousLeadConfigs: snapshot.previousLeadConfigs,
                previousClientConfigs: snapshot.previousClientConfigs,
                previousConsultantConfigs: snapshot.previousConsultantConfigs,
                previousTaskBillableRollups: snapshot.previousTaskBillableRollups,
                capacityGridConfig: snapshot.capacityGridConfig,
                capacityGridConfigsForYear: nextCapacityGridConfigsForYear,
            };
        });

        setTaskBillableRollupsState(snapshot.taskBillableRollups ?? []);
        setCapacityGridState(snapshot.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
        setActiveWeekStrState(week);
    }, []);

    useEffect(() => {
        const currentSnapshot: DashboardWeekSnapshot = {
            weekConfig: dbConfig?.weekConfig,
            leadConfigs: dbConfig?.leadConfigs,
            clientConfigs: dbConfig?.clientConfigs,
            clientDirectory: dbConfig?.clientDirectory,
            consultantConfigs: dbConfig?.consultantConfigs,
            previousLeadConfigs: dbConfig?.previousLeadConfigs,
            previousClientConfigs: dbConfig?.previousClientConfigs,
            previousConsultantConfigs: dbConfig?.previousConsultantConfigs,
            previousTaskBillableRollups: dbConfig?.previousTaskBillableRollups,
            capacityGridConfig: dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID,
            taskBillableRollups: initialTaskBillableRollups,
        };
        weekSnapshotCacheRef.current.set(getWeekCacheKey(weekStartStr), currentSnapshot);
    }, [dbConfig, getWeekCacheKey, initialTaskBillableRollups, weekStartStr]);

    const prefetchWeekSnapshot = useCallback((week: string) => {
        const cacheKey = getWeekCacheKey(week);
        if (weekSnapshotCacheRef.current.has(cacheKey) || weekPrefetchInFlightRef.current.has(cacheKey)) {
            return;
        }

        weekPrefetchInFlightRef.current.add(cacheKey);
        void loadDashboardWeekData(
            week,
            consultantsForRoster.map((consultant) => ({ id: consultant.id, name: consultant.name }))
        ).then((snapshot) => {
            weekSnapshotCacheRef.current.set(cacheKey, snapshot);
        }).catch(() => {
            // Ignore prefetch failures; the explicit navigation path will retry.
        }).finally(() => {
            weekPrefetchInFlightRef.current.delete(cacheKey);
        });
    }, [consultantsForRoster, getWeekCacheKey]);

    useEffect(() => {
        const activeWeekDate = new Date(`${activeWeekStrState}T00:00:00`);
        const previousWeek = new Date(activeWeekDate);
        previousWeek.setDate(previousWeek.getDate() - 7);
        const nextWeek = new Date(activeWeekDate);
        nextWeek.setDate(nextWeek.getDate() + 7);
        prefetchWeekSnapshot(previousWeek.toISOString().slice(0, 10));
        prefetchWeekSnapshot(nextWeek.toISOString().slice(0, 10));
    }, [activeWeekStrState, prefetchWeekSnapshot]);

    const handleWeekChange = useCallback((nextWeek: string) => {
        if (nextWeek === activeWeekStrState) return;

        const currentYear = new Date(`${activeWeekStrState}T00:00:00`).getFullYear();
        const nextYear = new Date(`${nextWeek}T00:00:00`).getFullYear();
        const nextHref = buildDashboardHref(nextWeek, resolvedActiveTab, selectedListIdState, selectedFolderIdState, selectedAssigneeFilterState);

        if (nextYear !== currentYear) {
            router.push(nextHref, { scroll: false });
            return;
        }

        const requestId = weekRequestIdRef.current + 1;
        weekRequestIdRef.current = requestId;
        setIsWeekLoading(true);

        const cacheKey = getWeekCacheKey(nextWeek);
        const cachedSnapshot = weekSnapshotCacheRef.current.get(cacheKey);
        if (cachedSnapshot) {
            applyWeekSnapshot(nextWeek, cachedSnapshot);
            syncBrowserUrl(nextHref);
            setIsWeekLoading(false);
            return;
        }

        void loadDashboardWeekData(
            nextWeek,
            consultantsForRoster.map((consultant) => ({ id: consultant.id, name: consultant.name }))
        ).then((snapshot) => {
            weekSnapshotCacheRef.current.set(cacheKey, snapshot);
            if (weekRequestIdRef.current !== requestId) return;
            applyWeekSnapshot(nextWeek, snapshot);
            syncBrowserUrl(nextHref);
        }).catch((error) => {
            if (weekRequestIdRef.current === requestId) {
                console.error("Failed to load dashboard week snapshot", error);
            }
        }).finally(() => {
            if (weekRequestIdRef.current === requestId) {
                setIsWeekLoading(false);
            }
        });
    }, [
        activeWeekStrState,
        applyWeekSnapshot,
        buildDashboardHref,
        consultantsForRoster,
        getWeekCacheKey,
        resolvedActiveTab,
        router,
        selectedAssigneeFilterState,
        selectedFolderIdState,
        selectedListIdState,
        syncBrowserUrl,
    ]);

    const baseConsultantConfigsById = useMemo(() => {
        const byId = new Map<number, { maxCapacity: number; billableCapacity: number; notes: string }>();
        consultantsForRoster.forEach((consultant) => {
            byId.set(consultant.id, { maxCapacity: 40, billableCapacity: 40, notes: "" });
        });

        const consultantConfigs = Array.isArray(dashboardConfigState?.consultantConfigs) ? dashboardConfigState.consultantConfigs : [];
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
    }, [consultantsForRoster, dashboardConfigState?.consultantConfigs]);

    const [consultantConfigsState, setConsultantConfigsState] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(baseConsultantConfigsById);

    useEffect(() => {
        setConsultantConfigsState(baseConsultantConfigsById);
    }, [activeWeekStrState, baseConsultantConfigsById]);

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

        const prevRows = Array.isArray(dashboardConfigState?.previousConsultantConfigs) ? dashboardConfigState.previousConsultantConfigs : [];
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
    }, [consultantsFromTasks, dashboardConfigState?.previousConsultantConfigs]);

    const mergedDbConfig = useMemo(() => ({
        ...dashboardConfigState,
        capacityGridConfig: capacityGridState,
        taskBillableRollups: taskBillableRollupsState,
        consultantConfigs: consultantConfigsForCommandCenter,
        previousConsultantConfigs: previousConsultantConfigsForCommandCenter,
    }), [dashboardConfigState, capacityGridState, consultantConfigsForCommandCenter, previousConsultantConfigsForCommandCenter, taskBillableRollupsState]);

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

    const handleConsultantConfigReplace = useCallback((nextConfigs: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>) => {
        setConsultantConfigsState(nextConfigs);
    }, []);

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-sm selection:bg-primary/30 selection:text-white">
            <Sidebar
                folders={availableFolders}
                clientOptions={clientOptions}
                selectedListId={selectedListIdState}
                selectedFolderId={selectedFolderIdState}
                activeTab={resolvedActiveTab}
                weekStr={activeWeekStrState}
                assigneeFilter={selectedAssigneeFilterState}
                onSelectList={handleListSelect}
                onSelectFolder={handleFolderSelect}
                onSelectTab={handleTabSelect}
                teamsLabel="Teams"
            />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                {/* Header Bar */}
                <header className="h-[68px] border-b border-border flex items-center justify-between px-6 pt-2 shrink-0 bg-background/90 backdrop-blur-md z-20">
                    <div className="flex items-center gap-3">
                        <MissionEngineMark className="h-9 w-9 rounded-xl" />
                        <div className="min-w-0">
                            <h1 className="font-semibold text-white leading-tight">Mission Engine</h1>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-text-muted/85">Live Operations</div>
                        </div>
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
                                activeWeekStr={activeWeekStrState}
                                tasks={proServicesTasks}
                                scopeType={editableTaskScope.type}
                                scopeId={editableTaskScope.id}
                                scopeName={editableTaskScope.name}
                                scopeParentFolderId={selectedBoardMeta?.parentFolderId ?? null}
                                assigneeOptions={activeConsultantNames}
                                initialAssigneeFilter={selectedAssigneeFilterState}
                                tabId="issues"
                                onNavigateWeek={handleWeekChange}
                                onAssigneeFilterChange={handleAssigneeFilterChange}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "command-center" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CommandCenter
                                tasks={proServicesTasks}
                                timeEntries={initialTimeEntries}
                                activeWeekStr={activeWeekStrState}
                                dbConfig={mergedDbConfig}
                                onNavigateWeek={handleWeekChange}
                                isWeekLoading={isWeekLoading}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "trends" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <Trends
                                activeWeekStr={activeWeekStrState}
                                weeklyTrend={Array.isArray(mergedDbConfig?.weeklyTrend) ? mergedDbConfig.weeklyTrend : []}
                                onNavigateWeek={handleWeekChange}
                                isWeekLoading={isWeekLoading}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "capacity-trends" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CapacityTrends
                                activeWeekStr={activeWeekStrState}
                                consultants={consultantsFromTasks}
                                consultantConfigsForYear={Array.isArray(mergedDbConfig?.consultantConfigsForYear) ? mergedDbConfig.consultantConfigsForYear : []}
                                consultantConfigsCurrentWeek={Array.isArray(mergedDbConfig?.consultantConfigs) ? mergedDbConfig.consultantConfigs : []}
                                capacityGridConfigsForYear={Array.isArray(mergedDbConfig?.capacityGridConfigsForYear) ? mergedDbConfig.capacityGridConfigsForYear : []}
                                onNavigateWeek={handleWeekChange}
                                isWeekLoading={isWeekLoading}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "capacity-grid" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CapacityGrid
                                activeWeekStr={activeWeekStrState}
                                initialGrid={capacityGridState}
                                onGridChange={setCapacityGridState}
                                consultants={consultantsForRoster}
                                consultantConfigsById={consultantConfigsState}
                                clientDirectory={Array.isArray(dashboardConfigState?.clientDirectory) ? dashboardConfigState.clientDirectory : []}
                                tasks={proServicesTasks}
                                folders={availableFolders}
                                activeAssigneeFilter={selectedAssigneeFilterState}
                                billableRollups={taskBillableRollupsState}
                                onNavigateWeek={handleWeekChange}
                                onSelectTab={handleTabSelect}
                                onOpenTaskBoard={handleCapacityGridOpenTaskBoard}
                                isWeekLoading={isWeekLoading}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "client-setup" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ClientSetup initialClients={Array.isArray(dashboardConfigState?.clientDirectory) ? dashboardConfigState.clientDirectory : []} />
                        </section>
                    )}

                    {resolvedActiveTab === "consultant-utilization" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ConsultantUtilization
                                activeWeekStr={activeWeekStrState}
                                consultants={consultantsForRoster}
                                consultantDirectory={consultantsFromDirectory}
                                consultantConfigsById={consultantConfigsState}
                                capacityGrid={capacityGridState}
                                onConsultantConfigChange={handleConsultantConfigChange}
                                onConsultantConfigReplace={handleConsultantConfigReplace}
                                onCapacityGridChange={setCapacityGridState}
                                onNavigateWeek={handleWeekChange}
                                isWeekLoading={isWeekLoading}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "timesheets" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <Timesheets
                                activeWeekStr={activeWeekStrState}
                                tasks={proServicesTasks}
                                consultants={consultantsForRoster}
                                capacityGrid={capacityGridState}
                                initialAssigneeFilter={selectedAssigneeFilterState}
                                onNavigateWeek={handleWeekChange}
                                onAssigneeFilterChange={handleTimesheetAssigneeFilterChange}
                                isWeekLoading={isWeekLoading}
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
