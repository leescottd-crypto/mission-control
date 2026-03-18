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
    ChevronDown,
    ChevronRight,
    Plus,
    Trash2,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    createTaskSidebarBoard,
    createTaskSidebarFolder,
    deleteTaskSidebarBoard,
    deleteTaskSidebarFolder,
    hideTaskSidebarBoard,
} from "@/app/actions";

export interface FolderWithLists {
    id: string;
    name: string;
    source?: "clickup" | "local";
    lists: { id: string; name: string; statusOrder?: string[]; source?: "clickup" | "local" }[];
}

interface SidebarProps {
    folders?: FolderWithLists[];
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
    { icon: Grid2x2, label: "Capacity Grid", id: "capacity-grid" },
];

const projectItems = [
    { icon: BarChart3, label: "Backlog Growth", id: "backlog-growth" },
];

export function Sidebar({
    folders = [],
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
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [isMounted, setIsMounted] = useState(false);
    const [isMutating, startTransition] = useTransition();
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [createBoardTarget, setCreateBoardTarget] = useState<{ folderId: string; folderName: string } | null>(null);
    const [newBoardName, setNewBoardName] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<{ type: "folder" | "board"; id: string; name: string; parentFolderId?: string | null; source?: "clickup" | "local" } | null>(null);
    const router = useRouter();

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const clientBoardOptions = useMemo(() => {
        const unique = new Map<string, string>();
        folders.forEach((folder) => {
            folder.lists.forEach((list) => {
                const name = String(list.name ?? "").trim();
                if (!name) return;
                const key = name.toLowerCase();
                if (!unique.has(key)) unique.set(key, name);
            });
        });
        return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
    }, [folders]);

    const boardExistsInTarget = useMemo(() => {
        if (!createBoardTarget || !newBoardName.trim()) return false;
        const targetFolder = folders.find((folder) => folder.id === createBoardTarget.folderId);
        if (!targetFolder) return false;
        const normalizedNewBoard = newBoardName.trim().toLowerCase();
        return targetFolder.lists.some((list) => String(list.name ?? "").trim().toLowerCase() === normalizedNewBoard);
    }, [createBoardTarget, folders, newBoardName]);

    const existingBoardNamesInTarget = useMemo(() => {
        if (!createBoardTarget) return new Set<string>();
        const targetFolder = folders.find((folder) => folder.id === createBoardTarget.folderId);
        return new Set(
            (targetFolder?.lists ?? [])
                .map((list) => String(list.name ?? "").trim().toLowerCase())
                .filter(Boolean)
        );
    }, [createBoardTarget, folders]);

    useEffect(() => {
        if (!createBoardTarget) return;
        if (newBoardName.trim()) return;
        const targetFolder = folders.find((folder) => folder.id === createBoardTarget.folderId);
        const existingNames = new Set(
            (targetFolder?.lists ?? [])
                .map((list) => String(list.name ?? "").trim().toLowerCase())
                .filter(Boolean)
        );
        const nextAvailable = clientBoardOptions.find((name) => !existingNames.has(name.toLowerCase())) ?? clientBoardOptions[0] ?? "";
        setNewBoardName(nextAvailable);
    }, [clientBoardOptions, createBoardTarget, folders, newBoardName]);

    const toggleFolder = (folderId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setExpandedFolders(prev => ({
            ...prev,
            [folderId]: prev[folderId] === undefined ? false : !prev[folderId]
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
        if (!trimmed || boardExistsInTarget) return;
        startTransition(async () => {
            const created = await createTaskSidebarBoard({
                parentFolderId: createBoardTarget.folderId,
                name: trimmed,
            });
            setCreateBoardTarget(null);
            setNewBoardName("");
            router.refresh();
            if (created) {
                window.location.href = buildHref("issues", created.id, null);
            }
        });
    };

    const handleDeleteTarget = () => {
        if (!deleteTarget) return;
        startTransition(async () => {
            if (deleteTarget.type === "folder") {
                await deleteTaskSidebarFolder(deleteTarget.id);
                const deletingActiveFolder = selectedFolderId === deleteTarget.id;
                setDeleteTarget(null);
                router.refresh();
                if (deletingActiveFolder) {
                    window.location.href = buildHref("issues");
                }
                return;
            }

            if (deleteTarget.source === "clickup") {
                await hideTaskSidebarBoard(deleteTarget.id);
            } else {
                await deleteTaskSidebarBoard(deleteTarget.id);
            }
            const deletingActiveBoard = selectedListId === deleteTarget.id;
            const parentFolderId = deleteTarget.parentFolderId ?? null;
            setDeleteTarget(null);
            router.refresh();
            if (deletingActiveBoard) {
                window.location.href = parentFolderId ? buildHref("issues", null, parentFolderId) : buildHref("issues");
            }
        });
    };

    const modalRoot = isMounted && typeof document !== "undefined" ? document.body : null;

    return (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-full shrink-0 relative z-10">
            {/* Top Header Placeholder */}
            <div className="h-14 flex items-center px-4 border-b border-border shadow-sm">
                <a
                    href={buildHref("command-center")}
                    className="flex items-center gap-2 w-full cursor-pointer hover:bg-surface-hover p-1.5 rounded-md transition-colors"
                >
                    <div className="w-5 h-5 bg-primary rounded shadow-glow flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                        MC
                    </div>
                    <span className="font-medium text-text-main text-sm truncate">Mission Control</span>
                </a>
            </div>

            <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto custom-scrollbar">

                {/* Main Nav */}
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <a
                                key={item.id}
                                href={buildHref(item.id, selectedListId, selectedFolderId)}
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
                            </a>
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
                            <a
                                key={item.id}
                                href={buildHref(item.id, selectedListId, selectedFolderId)}
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
                            </a>
                        );
                    })}
                </div>

                {/* Folders List */}
                {folders.length > 0 && (
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
                        {folders.map((folder) => {
                            const isExpanded = expandedFolders[folder.id] !== false; // true by default

                            return (
                                <div key={folder.id} className="space-y-1">
                                    <a
                                        href={buildHref("issues", null, folder.id)}
                                        className={cn(
                                            "w-full px-3 py-1.5 flex items-center gap-2 rounded-md border transition-colors text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                            selectedFolderId === folder.id
                                                ? "border-primary/35 bg-primary/10 text-text-main shadow-sm"
                                                : "border-transparent text-text-muted/80 hover:bg-surface-hover/30 hover:text-text-main"
                                        )}
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
                                            {folder.source === "local" && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setDeleteTarget({ type: "folder", id: folder.id, name: folder.name });
                                                    }}
                                                    className="inline-flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-200"
                                                    aria-label={`Remove ${folder.name}`}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    </a>

                                    {isExpanded && folder.lists.map((list) => {
                                        const isActive = selectedListId === list.id;
                                        return (
                                            <a
                                                key={list.id}
                                                href={buildHref("issues", list.id, null)}
                                                className={cn(
                                                    "w-full flex items-center gap-3 px-3 py-1.5 pl-8 rounded-md border transition-all duration-200 text-[13px] font-medium group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                                    isActive
                                                        ? "border-primary/45 bg-primary/12 text-text-main shadow-sm relative"
                                                        : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/20"
                                                )}
                                                title={list.name}
                                            >
                                                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />}
                                                <span className="truncate">{list.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setDeleteTarget({ type: "board", id: list.id, name: list.name, parentFolderId: folder.id, source: list.source });
                                                    }}
                                                    className="ml-auto inline-flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-200"
                                                    aria-label={`Remove ${list.name}`}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </a>
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
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Folder Name</span>
                                <input
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                    placeholder="Enter folder name"
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
                                <div className="text-xs text-text-muted">Select a client to add as a board under {createBoardTarget.folderName}.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCreateBoardTarget(null)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Client</span>
                                <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-background/40 p-2">
                                    <div className="space-y-2">
                                        {clientBoardOptions.map((name) => {
                                            const isSelected = newBoardName === name;
                                            const existsInFolder = existingBoardNamesInTarget.has(name.toLowerCase());
                                            return (
                                                <button
                                                    key={name}
                                                    type="button"
                                                    onClick={() => !existsInFolder && setNewBoardName(name)}
                                                    disabled={existsInFolder}
                                                    className={cn(
                                                        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                                                        existsInFolder
                                                            ? "cursor-not-allowed border-border/40 bg-white/[0.02] text-text-muted/50"
                                                            : isSelected
                                                                ? "border-primary/45 bg-primary/12 text-white shadow-sm"
                                                                : "border-border/50 bg-white/[0.03] text-text-main hover:bg-surface-hover hover:text-white"
                                                    )}
                                                >
                                                    <span className="truncate">{name}</span>
                                                    <span className="ml-3 shrink-0 text-[11px] uppercase tracking-wider text-text-muted">
                                                        {existsInFolder ? "Added" : isSelected ? "Selected" : "Client"}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            {boardExistsInTarget && (
                                <div className="text-xs text-amber-300">
                                    That client board already exists in this folder.
                                </div>
                            )}
                            {clientBoardOptions.length === 0 && (
                                <div className="text-xs text-text-muted">
                                    No client boards are available to copy into this folder yet.
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setCreateBoardTarget(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateBoard}
                                disabled={isMutating || !newBoardName.trim() || boardExistsInTarget || clientBoardOptions.length === 0}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm text-white hover:bg-primary/25 disabled:opacity-60"
                            >
                                <Plus className="w-4 h-4" />
                                Create Board
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
                            {deleteTarget.type === "board" && deleteTarget.source === "clickup"
                                ? "This only removes the board from Mission Control. It does not delete anything in ClickUp."
                                : `Any editable tasks saved inside this ${deleteTarget.type} will also be removed.`}
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
