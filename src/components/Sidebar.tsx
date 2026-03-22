"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import {
    BarChart2,
    BarChart3,
    Grid2x2,
    TrendingUp,
    Activity,
    Users,
    Settings,
    Folder,
    Building2,
    ChevronDown,
    ChevronRight,
    GripVertical,
    Pencil,
    Plus,
    Trash2,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    createTaskSidebarBoard,
    createTaskSidebarFolder,
    removeTaskSidebarBoard,
    removeTaskSidebarFolder,
    saveTaskSidebarBoardLayout,
    updateTaskSidebarBoard,
    updateTaskSidebarFolder,
} from "@/app/actions";

export interface FolderWithLists {
    id: string;
    name: string;
    source?: "clickup" | "local";
    lists: { id: string; name: string; statusOrder?: string[]; source?: "clickup" | "local"; clientId?: string | null; clientName?: string | null }[];
}

interface SidebarClientOption {
    id: string;
    name: string;
}

interface SidebarProps {
    folders?: FolderWithLists[];
    clientOptions?: SidebarClientOption[];
    selectedListId?: string | null;
    selectedFolderId?: string | null;
    activeTab?: string;
    weekStr?: string;
    assigneeFilter?: string | null;
    onSelectList?: (id: string | null) => void;
    onSelectFolder?: (id: string | null) => void;
    onSelectTab?: (tab: string) => void;
    teamsLabel?: string;
}

const navItems = [
    { icon: BarChart2, label: "Command Center", id: "command-center" },
    { icon: TrendingUp, label: "Billing Trends", id: "trends" },
    { icon: Activity, label: "Capacity Trends", id: "capacity-trends" },
    { icon: Users, label: "Consultant Utilization", id: "consultant-utilization" },
    { icon: Users, label: "Timesheets", id: "timesheets" },
    { icon: Grid2x2, label: "Capacity Grid", id: "capacity-grid" },
    { icon: Building2, label: "Client Setup", id: "client-setup" },
];

const projectItems = [
    { icon: BarChart3, label: "Backlog Growth", id: "backlog-growth" },
];

export function Sidebar({
    folders = [],
    clientOptions = [],
    selectedListId = null,
    selectedFolderId = null,
    activeTab = "issues",
    weekStr = "",
    assigneeFilter = null,
    onSelectList = () => { },
    onSelectFolder = () => { },
    onSelectTab = () => { },
    teamsLabel = "Teams",
}: SidebarProps) {
    const expandedFoldersStorageKey = "mission-control:expanded-folders";
    const [visibleFolders, setVisibleFolders] = useState<FolderWithLists[]>(folders);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [isMounted, setIsMounted] = useState(false);
    const [isMutating, startTransition] = useTransition();
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [createBoardTarget, setCreateBoardTarget] = useState<{ folderId: string; folderName: string } | null>(null);
    const [newBoardName, setNewBoardName] = useState("");
    const [newBoardClientId, setNewBoardClientId] = useState("");
    const [editFolderTarget, setEditFolderTarget] = useState<{ id: string; name: string; source: "clickup" | "local" } | null>(null);
    const [editFolderName, setEditFolderName] = useState("");
    const [editBoardTarget, setEditBoardTarget] = useState<{ id: string; name: string; source: "clickup" | "local"; parentFolderId: string; clientId?: string | null; clientName?: string | null } | null>(null);
    const [editBoardName, setEditBoardName] = useState("");
    const [editBoardClientId, setEditBoardClientId] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<{ type: "folder" | "board"; id: string; name: string; parentFolderId?: string | null } | null>(null);
    const [draggingBoard, setDraggingBoard] = useState<{ id: string; name: string; source: "clickup" | "local"; parentFolderId: string; clientId?: string | null; clientName?: string | null } | null>(null);
    const [dropPreview, setDropPreview] = useState<{ folderId: string; boardId?: string | null; position: "inside" | "before" | "after" } | null>(null);
    const router = useRouter();

    useEffect(() => {
        setIsMounted(true);
        if (typeof window === "undefined") return;
        try {
            const saved = window.sessionStorage.getItem(expandedFoldersStorageKey);
            if (saved) {
                setExpandedFolders(JSON.parse(saved));
            }
        } catch {
            // Ignore storage parse issues and fall back to closed-by-default behavior.
        }
    }, []);

    useEffect(() => {
        setVisibleFolders(folders);
    }, [folders]);

    useEffect(() => {
        if (!isMounted || typeof window === "undefined") return;
        window.sessionStorage.setItem(expandedFoldersStorageKey, JSON.stringify(expandedFolders));
    }, [expandedFolders, expandedFoldersStorageKey, isMounted]);

    const clientById = useMemo(() => {
        const map = new Map<string, SidebarClientOption>();
        clientOptions.forEach((client) => {
            const id = String(client.id ?? "").trim();
            const name = String(client.name ?? "").trim();
            if (!id || !name) return;
            map.set(id, { id, name });
        });
        return map;
    }, [clientOptions]);

    const selectedNewBoardClient = newBoardClientId ? clientById.get(newBoardClientId) ?? null : null;
    const selectedEditBoardClient = editBoardClientId ? clientById.get(editBoardClientId) ?? null : null;

    const boardExistsInTarget = useMemo(() => {
        if (!createBoardTarget || !newBoardName.trim()) return false;
        const targetFolder = visibleFolders.find((folder) => folder.id === createBoardTarget.folderId);
        if (!targetFolder) return false;
        const normalizedNewBoard = newBoardName.trim().toLowerCase();
        return targetFolder.lists.some((list) => String(list.name ?? "").trim().toLowerCase() === normalizedNewBoard);
    }, [createBoardTarget, visibleFolders, newBoardName]);

    useEffect(() => {
        if (!createBoardTarget) return;
        if (newBoardName.trim()) return;
        const targetFolder = visibleFolders.find((folder) => folder.id === createBoardTarget.folderId);
        const existingNames = new Set(
            (targetFolder?.lists ?? [])
                .map((list) => String(list.name ?? "").trim().toLowerCase())
                .filter(Boolean)
        );
        const defaultClient = selectedNewBoardClient ?? clientOptions[0] ?? null;
        if (!defaultClient) return;
        if (!newBoardClientId) {
            setNewBoardClientId(defaultClient.id);
        }
        let nextAvailable = defaultClient.name;
        let suffix = 2;
        while (existingNames.has(nextAvailable.toLowerCase())) {
            nextAvailable = `${defaultClient.name} ${suffix}`;
            suffix += 1;
        }
        setNewBoardName(nextAvailable);
    }, [clientOptions, createBoardTarget, newBoardClientId, newBoardName, selectedNewBoardClient, visibleFolders]);

    const toggleFolder = (folderId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setExpandedFolders(prev => ({
            ...prev,
            [folderId]: prev[folderId] === undefined ? true : !prev[folderId]
        }));
    };

    const buildHref = (tab: string, listId?: string | null, folderId?: string | null) => {
        const params = new URLSearchParams();
        if (weekStr) params.set("week", weekStr);
        params.set("tab", tab);
        if (assigneeFilter) params.set("assignee", assigneeFilter);
        if (listId) {
            params.set("listId", listId);
        } else if (folderId) {
            params.set("folderId", folderId);
        }
        const qs = params.toString();
        return qs ? `/?${qs}` : "/";
    };

    const handleCreateFolder = () => {
        const trimmed = newFolderName.trim();
        if (!trimmed) return;
        startTransition(async () => {
            const created = await createTaskSidebarFolder(trimmed);
            setCreateFolderOpen(false);
            setNewFolderName("");
            router.refresh();
            if (created) {
                window.location.href = buildHref("issues", null, created.id);
            }
        });
    };

    const handleCreateBoard = () => {
        if (!createBoardTarget) return;
        const trimmed = newBoardName.trim();
        const selectedClient = selectedNewBoardClient;
        if (!trimmed || boardExistsInTarget || !selectedClient) return;
        startTransition(async () => {
            const created = await createTaskSidebarBoard({
                parentFolderId: createBoardTarget.folderId,
                name: trimmed,
                clientId: selectedClient.id,
                clientName: selectedClient.name,
            });
            setCreateBoardTarget(null);
            setNewBoardName("");
            setNewBoardClientId("");
            router.refresh();
            if (created) {
                window.location.href = buildHref("issues", created.id, null);
            }
        });
    };

    const closeCreateBoardModal = () => {
        setCreateBoardTarget(null);
        setNewBoardName("");
        setNewBoardClientId("");
    };

    const handleDeleteTarget = () => {
        if (!deleteTarget) return;
        startTransition(async () => {
            if (deleteTarget.type === "folder") {
                await removeTaskSidebarFolder(deleteTarget.id);
                const deletingActiveFolder = selectedFolderId === deleteTarget.id;
                setDeleteTarget(null);
                router.refresh();
                if (deletingActiveFolder) {
                    window.location.href = buildHref("issues");
                }
                return;
            }

            await removeTaskSidebarBoard(deleteTarget.id);
            const deletingActiveBoard = selectedListId === deleteTarget.id;
            const parentFolderId = deleteTarget.parentFolderId ?? null;
            setDeleteTarget(null);
            router.refresh();
            if (deletingActiveBoard) {
                window.location.href = parentFolderId ? buildHref("issues", null, parentFolderId) : buildHref("issues");
            }
        });
    };

    useEffect(() => {
        if (!editFolderTarget) return;
        setEditFolderName(editFolderTarget.name);
    }, [editFolderTarget]);

    useEffect(() => {
        if (!editBoardTarget) return;
        setEditBoardName(editBoardTarget.name);
        setEditBoardClientId(String(editBoardTarget.clientId ?? ""));
    }, [editBoardTarget]);

    const applyBoardUpdateLocally = (input: {
        boardId: string;
        parentFolderId: string;
        name: string;
        clientId: string;
        clientName: string;
    }) => {
        setVisibleFolders((prev) => prev.map((folder) => {
            if (folder.id !== input.parentFolderId) return folder;
            return {
                ...folder,
                lists: folder.lists.map((list) => (
                    list.id !== input.boardId
                        ? list
                        : {
                            ...list,
                            name: input.name,
                            clientId: input.clientId,
                            clientName: input.clientName,
                        }
                )),
            };
        }));
    };

    const handleEditFolder = () => {
        if (!editFolderTarget) return;
        const trimmed = editFolderName.trim();
        if (!trimmed) return;
        startTransition(async () => {
            await updateTaskSidebarFolder({
                folderId: editFolderTarget.id,
                source: editFolderTarget.source,
                name: trimmed,
            });
            setVisibleFolders((prev) => prev.map((folder) => (
                folder.id === editFolderTarget.id ? { ...folder, name: trimmed } : folder
            )));
            setEditFolderTarget(null);
            setEditFolderName("");
            router.refresh();
        });
    };

    const handleEditBoard = () => {
        if (!editBoardTarget) return;
        const trimmed = editBoardName.trim();
        const selectedClient = selectedEditBoardClient;
        if (!trimmed || !selectedClient) return;
        startTransition(async () => {
            await updateTaskSidebarBoard({
                boardId: editBoardTarget.id,
                source: editBoardTarget.source,
                parentFolderId: editBoardTarget.parentFolderId,
                name: trimmed,
                clientId: selectedClient.id,
                clientName: selectedClient.name,
            });
            applyBoardUpdateLocally({
                boardId: editBoardTarget.id,
                parentFolderId: editBoardTarget.parentFolderId,
                name: trimmed,
                clientId: selectedClient.id,
                clientName: selectedClient.name,
            });
            setEditBoardTarget(null);
            setEditBoardName("");
            setEditBoardClientId("");
            router.refresh();
        });
    };

    const modalRoot = isMounted && typeof document !== "undefined" ? document.body : null;

    const getFolderBoards = (folderId: string) => {
        const folder = visibleFolders.find((item) => item.id === folderId);
        return (folder?.lists ?? [])
            .map((list) => ({
                boardId: String(list.id),
                boardName: String(list.name ?? ""),
                clientId: list.clientId == null ? null : String(list.clientId),
                clientName: list.clientName == null ? null : String(list.clientName),
                source: list.source === "local" ? "local" as const : "clickup" as const,
            }));
    };

    const buildFolderLayouts = (nextFolders: FolderWithLists[]) =>
        nextFolders.map((folder) => ({
            folderId: String(folder.id),
            boards: folder.lists.map((list) => ({
                boardId: String(list.id),
                boardName: String(list.name ?? ""),
                clientId: list.clientId == null ? null : String(list.clientId),
                clientName: list.clientName == null ? null : String(list.clientName),
                source: list.source === "local" ? "local" as const : "clickup" as const,
            })),
        }));

    const handleBoardDrop = (
        targetFolderId: string,
        targetBoardId: string | null = null,
        position: "inside" | "before" | "after" = "inside"
    ) => {
        if (!draggingBoard) return;

        const sourceBoards = getFolderBoards(draggingBoard.parentFolderId)
            .filter((board) => board.boardId !== draggingBoard.id);
        const targetBoardsBase = draggingBoard.parentFolderId === targetFolderId
            ? sourceBoards
            : getFolderBoards(targetFolderId).filter((board) => board.boardId !== draggingBoard.id);
        let targetIndex = targetBoardsBase.length;

        if (targetBoardId) {
            const boardIndex = targetBoardsBase.findIndex((board) => board.boardId === targetBoardId);
            if (boardIndex >= 0) {
                targetIndex = position === "after" ? boardIndex + 1 : boardIndex;
            }
        }

        const reorderedTargetBoards = [...targetBoardsBase];
        reorderedTargetBoards.splice(targetIndex, 0, {
            boardId: draggingBoard.id,
            boardName: draggingBoard.name,
            clientId: draggingBoard.clientId == null ? null : String(draggingBoard.clientId),
            clientName: draggingBoard.clientName == null ? null : String(draggingBoard.clientName),
            source: draggingBoard.source,
        });

        const nextVisibleFolders = visibleFolders.map((folder) => {
            if (folder.id === draggingBoard.parentFolderId && folder.id === targetFolderId) {
                return {
                    ...folder,
                    lists: reorderedTargetBoards.map((board) => ({
                        id: board.boardId,
                        name: board.boardName,
                        clientId: board.clientId,
                        clientName: board.clientName,
                        source: board.source,
                    })),
                };
            }
            if (folder.id === draggingBoard.parentFolderId) {
                return {
                    ...folder,
                    lists: sourceBoards.map((board) => ({
                        id: board.boardId,
                        name: board.boardName,
                        clientId: board.clientId,
                        clientName: board.clientName,
                        source: board.source,
                    })),
                };
            }
            if (folder.id === targetFolderId) {
                return {
                    ...folder,
                    lists: reorderedTargetBoards.map((board) => ({
                        id: board.boardId,
                        name: board.boardName,
                        clientId: board.clientId,
                        clientName: board.clientName,
                        source: board.source,
                    })),
                };
            }
            return folder;
        });

        setVisibleFolders(nextVisibleFolders);

        startTransition(async () => {
            await saveTaskSidebarBoardLayout({
                folders: buildFolderLayouts(nextVisibleFolders),
            });
            setDraggingBoard(null);
            setDropPreview(null);
            router.refresh();
        });
    };

    return (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-full shrink-0 relative z-10">
            {/* Top Header Placeholder */}
            <div className="h-14 flex items-center px-4 border-b border-border shadow-sm">
                <button
                    type="button"
                    onClick={() => onSelectTab("command-center")}
                    className="flex items-center gap-2 w-full cursor-pointer hover:bg-surface-hover p-1.5 rounded-md transition-colors"
                >
                    <div className="w-5 h-5 bg-primary rounded shadow-glow flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                        MC
                    </div>
                    <span className="font-medium text-text-main text-sm truncate">Mission Control</span>
                </button>
            </div>

            <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto custom-scrollbar">

                {/* Main Nav */}
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelectTab(item.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-1.5 rounded-md border transition-all duration-200 text-[13px] font-medium group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                    isActiveTab
                                        ? "border-primary/40 bg-primary/10 text-text-main shadow-sm"
                                        : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/30"
                                )}
                            >
                                {isMounted ? (
                                    <Icon className={cn(
                                        "w-4 h-4 transition-colors shrink-0",
                                        isActiveTab ? "text-primary" : "text-text-muted group-hover:text-text-main"
                                    )} />
                                ) : (
                                    <span className="w-4 h-4 shrink-0" aria-hidden />
                                )}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-2">
                    <div className="px-3">
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Projects</span>
                    </div>
                    {projectItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelectTab(item.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-1.5 rounded-md border transition-all duration-200 text-[13px] font-medium group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                    isActiveTab
                                        ? "border-primary/40 bg-primary/10 text-text-main shadow-sm"
                                        : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/30"
                                )}
                            >
                                {isMounted ? (
                                    <Icon className={cn(
                                        "w-4 h-4 transition-colors shrink-0",
                                        isActiveTab ? "text-primary" : "text-text-muted group-hover:text-text-main"
                                    )} />
                                ) : (
                                    <span className="w-4 h-4 shrink-0" aria-hidden />
                                )}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                {/* Folders List */}
                {visibleFolders.length > 0 && (
                    <div className="space-y-4 pb-4">
                        <div className="px-3 flex items-center justify-between">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{teamsLabel}</span>
                            <button
                                type="button"
                                onClick={() => setCreateFolderOpen(true)}
                                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-main hover:bg-surface-hover"
                            >
                                <Plus className="w-3 h-3" />
                                New Folder
                            </button>
                        </div>
                        {visibleFolders.map((folder) => {
                            const isExpanded = expandedFolders[folder.id] === true;

                            return (
                                <div key={folder.id} className="space-y-1">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => {
                                            onSelectTab("issues");
                                            onSelectFolder(folder.id);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                onSelectTab("issues");
                                                onSelectFolder(folder.id);
                                            }
                                        }}
                                        className={cn(
                                            "w-full px-3 py-1.5 flex items-center gap-2 rounded-md border transition-colors text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                            selectedFolderId === folder.id
                                                ? "border-primary/35 bg-primary/10 text-text-main shadow-sm"
                                                : "border-transparent text-text-muted/80 hover:bg-surface-hover/30 hover:text-text-main",
                                            dropPreview?.folderId === folder.id && !dropPreview?.boardId && "border-primary/45 bg-primary/10"
                                        )}
                                        onDragOver={(event) => {
                                            if (!draggingBoard) return;
                                            event.preventDefault();
                                            setDropPreview({ folderId: folder.id, boardId: null, position: "inside" });
                                        }}
                                        onDrop={(event) => {
                                            if (!draggingBoard) return;
                                            event.preventDefault();
                                            handleBoardDrop(folder.id);
                                        }}
                                    >
                                        <div
                                            className="p-0.5 -ml-1 rounded hover:bg-surface-hover/80 transition-colors"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                toggleFolder(folder.id, e);
                                            }}
                                        >
                                            {isMounted ? (
                                                isExpanded ? (
                                                    <ChevronDown className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main" />
                                                ) : (
                                                    <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main" />
                                                )
                                            ) : (
                                                <span className="w-3.5 h-3.5 block" aria-hidden />
                                            )}
                                        </div>
                                        {isMounted ? (
                                            <Folder className={cn(
                                                "w-3.5 h-3.5",
                                                selectedFolderId === folder.id ? "text-primary flex-shrink-0" : "text-text-muted/80 group-hover:text-text-main flex-shrink-0"
                                            )} />
                                        ) : (
                                            <span className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                        )}
                                        <span className="text-[11px] font-bold uppercase tracking-wider truncate flex-1">{folder.name}</span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setCreateBoardTarget({ folderId: folder.id, folderName: folder.name });
                                                }}
                                                className="inline-flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:border-border/60 hover:bg-surface-hover hover:text-white"
                                                aria-label={`Add board to ${folder.name}`}
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setEditFolderTarget({
                                                        id: folder.id,
                                                        name: folder.name,
                                                        source: folder.source === "local" ? "local" : "clickup",
                                                    });
                                                }}
                                                className="inline-flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:border-border/60 hover:bg-surface-hover hover:text-white"
                                                aria-label={`Rename ${folder.name}`}
                                            >
                                                <Pencil className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>

                                    {isExpanded && folder.lists.map((list) => {
                                        const isActive = selectedListId === list.id;
                                        const isDropTarget = dropPreview?.folderId === folder.id && dropPreview?.boardId === list.id;
                                        return (
                                            <button
                                                key={list.id}
                                                type="button"
                                                draggable
                                                onClick={() => {
                                                    onSelectTab("issues");
                                                    onSelectList(list.id);
                                                }}
                                                onDragStart={(event) => {
                                                    event.dataTransfer.effectAllowed = "move";
                                                    event.dataTransfer.setData("text/plain", list.id);
                                                    setDraggingBoard({
                                                        id: list.id,
                                                        name: list.name,
                                                        source: list.source === "local" ? "local" : "clickup",
                                                        parentFolderId: folder.id,
                                                        clientId: list.clientId ?? null,
                                                        clientName: list.clientName ?? null,
                                                    });
                                                }}
                                                onDragEnd={() => {
                                                    setDraggingBoard(null);
                                                    setDropPreview(null);
                                                }}
                                                onDragOver={(event) => {
                                                    if (!draggingBoard) return;
                                                    event.preventDefault();
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                                    setDropPreview({ folderId: folder.id, boardId: list.id, position });
                                                }}
                                                onDrop={(event) => {
                                                    if (!draggingBoard) return;
                                                    event.preventDefault();
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                                    handleBoardDrop(folder.id, list.id, position);
                                                }}
                                                className={cn(
                                                    "w-full flex items-center gap-3 px-3 py-1.5 pl-8 rounded-md border transition-all duration-200 text-[13px] font-medium group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                                    isActive
                                                        ? "border-primary/45 bg-primary/12 text-text-main shadow-sm relative"
                                                        : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/20",
                                                    isDropTarget && "border-primary/45 bg-primary/10",
                                                    draggingBoard?.id === list.id && "opacity-60 cursor-grabbing",
                                                    !draggingBoard?.id || draggingBoard.id !== list.id ? "cursor-grab" : ""
                                                )}
                                                title={list.name}
                                            >
                                                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />}
                                                <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-muted/70" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate">{list.name}</div>
                                                    {list.clientName && (
                                                        <div className="truncate text-[10px] uppercase tracking-wider text-text-muted/70">
                                                            {list.clientName}
                                                        </div>
                                                    )}
                                                </div>
                                                <span
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setEditBoardTarget({
                                                            id: list.id,
                                                            name: list.name,
                                                            source: list.source === "local" ? "local" : "clickup",
                                                            parentFolderId: folder.id,
                                                            clientId: list.clientId ?? null,
                                                            clientName: list.clientName ?? null,
                                                        });
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key !== "Enter" && event.key !== " ") return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setEditBoardTarget({
                                                            id: list.id,
                                                            name: list.name,
                                                            source: list.source === "local" ? "local" : "clickup",
                                                            parentFolderId: folder.id,
                                                            clientId: list.clientId ?? null,
                                                            clientName: list.clientName ?? null,
                                                        });
                                                    }}
                                                    className="inline-flex shrink-0 items-center justify-center rounded border border-transparent p-1 text-text-muted opacity-0 transition-opacity hover:border-border/60 hover:bg-surface-hover hover:text-white group-hover:opacity-100"
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                )}
            </nav>

            <div className="p-3 border-t border-border">
                <a
                    href="/settings"
                    className="flex items-center gap-3 px-3 py-2 rounded-md transition-all text-[13px] font-medium text-text-muted hover:text-text-main hover:bg-surface-hover"
                >
                    {isMounted ? (
                        <Settings className="w-4 h-4 shrink-0" />
                    ) : (
                        <span className="w-4 h-4 shrink-0" aria-hidden />
                    )}
                    Settings
                </a>
            </div>
            {createFolderOpen && modalRoot && createPortal((
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div>
                                <div className="text-sm font-semibold text-text-main">New Folder</div>
                                <div className="text-xs text-text-muted">Create a new task folder in the client panel.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCreateFolderOpen(false)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Team Name</span>
                                <input
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                    placeholder="Enter team name"
                                />
                            </label>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setCreateFolderOpen(false)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateFolder}
                                disabled={isMutating}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-white hover:bg-primary/25 disabled:opacity-60"
                            >
                                <Plus className="w-4 h-4" />
                                Create Folder
                            </button>
                        </div>
                    </div>
                </div>
            ), modalRoot)}
            {createBoardTarget && modalRoot && createPortal((
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div>
                                <div className="text-sm font-semibold text-text-main">New Board</div>
                                <div className="text-xs text-text-muted">Create a board under {createBoardTarget.folderName} and link it to a client.</div>
                            </div>
                            <button
                                type="button"
                                onClick={closeCreateBoardModal}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Linked Client</span>
                                <select
                                    value={newBoardClientId}
                                    onChange={(e) => {
                                        setNewBoardClientId(e.target.value);
                                        if (!newBoardName.trim()) {
                                            const selected = clientById.get(e.target.value);
                                            if (selected) setNewBoardName(selected.name);
                                        }
                                    }}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                >
                                    <option value="">Select client</option>
                                    {clientOptions.map((client) => (
                                        <option key={client.id} value={client.id}>
                                            {client.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Board Name</span>
                                <input
                                    value={newBoardName}
                                    onChange={(e) => setNewBoardName(e.target.value)}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                    placeholder="Enter board name"
                                />
                            </label>
                            {boardExistsInTarget && (
                                <div className="text-xs text-amber-300">
                                    A board with that name already exists in this team.
                                </div>
                            )}
                            {clientOptions.length === 0 && (
                                <div className="text-xs text-text-muted">
                                    No active clients are available yet. Add clients in Client Setup first.
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={closeCreateBoardModal}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateBoard}
                                disabled={isMutating || !newBoardName.trim() || !newBoardClientId || boardExistsInTarget || clientOptions.length === 0}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-white hover:bg-primary/25 disabled:opacity-60"
                            >
                                <Plus className="w-4 h-4" />
                                Create Board
                            </button>
                        </div>
                    </div>
                </div>
            ), modalRoot)}
            {editFolderTarget && modalRoot && createPortal((
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div>
                                <div className="text-sm font-semibold text-text-main">Rename Team</div>
                                <div className="text-xs text-text-muted">Update the team name shown in the folder view.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditFolderTarget(null)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Team Name</span>
                                <input
                                    value={editFolderName}
                                    onChange={(e) => setEditFolderName(e.target.value)}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                    placeholder="Enter team name"
                                />
                            </label>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setEditFolderTarget(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleEditFolder}
                                disabled={isMutating || !editFolderName.trim()}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-white hover:bg-primary/25 disabled:opacity-60"
                            >
                                <Pencil className="w-4 h-4" />
                                Save Team
                            </button>
                        </div>
                    </div>
                </div>
            ), modalRoot)}
            {editBoardTarget && modalRoot && createPortal((
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div>
                                <div className="text-sm font-semibold text-text-main">Edit Board</div>
                                <div className="text-xs text-text-muted">Rename the board and update its linked client.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditBoardTarget(null)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Linked Client</span>
                                <select
                                    value={editBoardClientId}
                                    onChange={(e) => setEditBoardClientId(e.target.value)}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                >
                                    <option value="">Select client</option>
                                    {clientOptions.map((client) => (
                                        <option key={client.id} value={client.id}>
                                            {client.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Board Name</span>
                                <input
                                    value={editBoardName}
                                    onChange={(e) => setEditBoardName(e.target.value)}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                    placeholder="Enter board name"
                                />
                            </label>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setEditBoardTarget(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleEditBoard}
                                disabled={isMutating || !editBoardName.trim() || !editBoardClientId}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-white hover:bg-primary/25 disabled:opacity-60"
                            >
                                <Pencil className="w-4 h-4" />
                                Save Board
                            </button>
                        </div>
                    </div>
                </div>
            ), modalRoot)}
            {deleteTarget && modalRoot && createPortal((
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div className="text-sm font-semibold text-text-main">Remove {deleteTarget.type === "folder" ? "Folder" : "Board"}</div>
                            <div className="mt-1 text-xs text-text-muted">
                                This will remove <span className="font-medium text-white">{deleteTarget.name}</span> from the client panel.
                            </div>
                        </div>
                        <div className="px-5 py-4 text-sm text-text-muted">
                            {`Any editable tasks saved inside this ${deleteTarget.type} will also be removed from Mission Control.`}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteTarget}
                                disabled={isMutating}
                                className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                            >
                                <Trash2 className="w-4 h-4" />
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            ), modalRoot)}
        </aside>
    );
}
