"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Save, Trash2 } from "lucide-react";
import { deleteClientDirectoryEntry, saveClientDirectoryEntry, type ClientDirectoryRecord } from "@/app/actions";
import { cn } from "@/lib/utils";

interface ClientSetupProps {
    initialClients: ClientDirectoryRecord[];
}

type EditableClient = ClientDirectoryRecord & {
    isNew?: boolean;
};

function toNullableNumber(value: string) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
}

export function ClientSetup({ initialClients }: ClientSetupProps) {
    const router = useRouter();
    const [clients, setClients] = useState<EditableClient[]>(initialClients);
    const [isPending, startTransition] = useTransition();
    const newClientRowIdRef = useRef<string | null>(null);

    useEffect(() => {
        setClients(initialClients);
    }, [initialClients]);

    const orderedClients = useMemo(
        () => [...clients].sort((a, b) => {
            if (a.isInternal !== b.isInternal) {
                return a.isInternal ? 1 : -1;
            }
            if (Number(a.sortOrder ?? 0) !== Number(b.sortOrder ?? 0)) {
                return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
            }
            return a.name.localeCompare(b.name);
        }),
        [clients]
    );

    const handleFieldChange = (clientId: string, patch: Partial<EditableClient>) => {
        setClients((prev) => prev.map((client) => (
            client.id === clientId ? { ...client, ...patch } : client
        )));
    };

    const handleAddClient = () => {
        const timestamp = Date.now();
        const id = `new-${timestamp}`;
        newClientRowIdRef.current = id;
        setClients((prev) => [
            ...prev,
            {
                id,
                name: "",
                team: null,
                sa: "",
                dealType: "",
                min: null,
                max: null,
                isActive: true,
                isInternal: false,
                sortOrder: prev.length,
                isNew: true,
            },
        ]);
    };

    useEffect(() => {
        if (!newClientRowIdRef.current) return;
        const row = document.querySelector<HTMLElement>(`[data-client-row="${newClientRowIdRef.current}"]`);
        if (!row) return;
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        const input = row.querySelector<HTMLInputElement>("input");
        if (input) {
            window.setTimeout(() => input.focus(), 120);
        }
        newClientRowIdRef.current = null;
    }, [clients]);

    const handleSave = (client: EditableClient) => {
        startTransition(async () => {
            const saved = await saveClientDirectoryEntry({
                id: client.isNew ? undefined : client.id,
                name: client.name,
                team: client.team,
                sa: client.sa,
                dealType: client.dealType,
                min: client.min,
                max: client.max,
                isActive: client.isActive,
                isInternal: client.isInternal,
                sortOrder: client.sortOrder,
            });
            if (!saved) return;
            setClients((prev) => prev.map((entry) => (
                entry.id === client.id ? saved : entry
            )));
            router.refresh();
        });
    };

    const handleRemove = (client: EditableClient) => {
        if (client.isInternal) return;
        if (client.isNew) {
            setClients((prev) => prev.filter((entry) => entry.id !== client.id));
            return;
        }
        if (!window.confirm(`Remove ${client.name} from client setup?`)) return;

        startTransition(async () => {
            await deleteClientDirectoryEntry(client.id);
            setClients((prev) => prev.filter((entry) => entry.id !== client.id));
            router.refresh();
        });
    };

    const activeCount = orderedClients.filter((client) => client.isActive).length;
    const externalTotals = useMemo(() => {
        return orderedClients
            .filter((client) => !client.isInternal)
            .reduce((acc, client) => {
                acc.min += Number(client.min ?? 0);
                acc.max += Number(client.max ?? 0);
                return acc;
            }, { min: 0, max: 0 });
    }, [orderedClients]);

    return (
        <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3 rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(21,26,43,0.96)_0%,rgba(13,18,29,0.96)_100%)] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-white/[0.04]">
                        <Building2 className="h-5 w-5 text-cyan-300" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-white">Client Setup</h2>
                        <p className="mt-1 text-xs text-text-muted">
                            Manage client metadata, active status, and the records shown across planning screens.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-[11px] text-text-muted">
                        {activeCount} active clients
                    </span>
                    <button
                        type="button"
                        onClick={handleAddClient}
                        className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-semibold text-white hover:bg-primary/25"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Client
                    </button>
                </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border/40 bg-[#111626]/90 text-left text-[11px] uppercase tracking-[0.18em] text-text-muted">
                            <tr>
                                <th className="px-4 py-3">Client</th>
                                <th className="px-4 py-3">Team</th>
                                <th className="px-4 py-3">SA</th>
                                <th className="px-4 py-3">Deal Type</th>
                                <th className="px-4 py-3 text-right">Min</th>
                                <th className="px-4 py-3 text-right">Max</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Internal</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orderedClients.map((client, index) => (
                                <tr data-client-row={client.id} key={client.id} className={cn("border-b border-border/30", index % 2 === 0 ? "bg-white/[0.01]" : "bg-white/[0.03]")}>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.name}
                                            onChange={(event) => handleFieldChange(client.id, { name: event.target.value })}
                                            className="w-64 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            placeholder="Client name"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.team ?? ""}
                                            onChange={(event) => handleFieldChange(client.id, { team: toNullableNumber(event.target.value) })}
                                            className="w-20 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            inputMode="numeric"
                                            placeholder="1"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.sa}
                                            onChange={(event) => handleFieldChange(client.id, { sa: event.target.value })}
                                            className="w-40 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            placeholder="Owner"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.dealType}
                                            onChange={(event) => handleFieldChange(client.id, { dealType: event.target.value })}
                                            className="w-40 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            placeholder="Managed Service"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            value={client.min ?? ""}
                                            onChange={(event) => handleFieldChange(client.id, { min: toNullableNumber(event.target.value) })}
                                            className="w-20 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-right text-sm text-white outline-none focus:border-primary"
                                            inputMode="decimal"
                                            placeholder="0"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            value={client.max ?? ""}
                                            onChange={(event) => handleFieldChange(client.id, { max: toNullableNumber(event.target.value) })}
                                            className="w-20 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-right text-sm text-white outline-none focus:border-primary"
                                            inputMode="decimal"
                                            placeholder="0"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={() => handleFieldChange(client.id, { isActive: !client.isActive })}
                                            className={cn(
                                                "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider",
                                                client.isActive
                                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                                                    : "border-border/60 bg-background/50 text-text-muted"
                                            )}
                                        >
                                            {client.isActive ? "Active" : "Inactive"}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        <label className="inline-flex items-center gap-2 text-xs text-text-muted">
                                            <input
                                                type="checkbox"
                                                checked={client.isInternal}
                                                onChange={(event) => handleFieldChange(client.id, { isInternal: event.target.checked })}
                                                className="h-4 w-4 rounded border-border bg-background/60"
                                            />
                                            Internal
                                        </label>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSave(client)}
                                                disabled={isPending || !client.name.trim()}
                                                className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.08] disabled:opacity-60"
                                            >
                                                <Save className="h-3.5 w-3.5" />
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemove(client)}
                                                disabled={isPending || client.isInternal}
                                                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Remove
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {orderedClients.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-6 py-10 text-center text-sm text-text-muted">
                                        No clients have been set up yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="border-t border-border/50 bg-cyan-500/8">
                            <tr>
                                <td colSpan={4} className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                    Totals Excluding Internal
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-semibold text-white">
                                    {externalTotals.min.toFixed(1)}
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-semibold text-white">
                                    {externalTotals.max.toFixed(1)}
                                </td>
                                <td colSpan={3}></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </section>
    );
}
