"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, MessageSquareText, Send, Sparkles } from "lucide-react";

interface PrimerResponse {
    providerLabel: string;
    helperText: string;
    suggestions: string[];
}

interface AssistantReply {
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

interface Message {
    id: string;
    role: "assistant" | "user";
    title?: string;
    body: string;
    bullets?: string[];
    meta?: string;
}

const DEFAULT_PRIMER: PrimerResponse = {
    providerLabel: "Deterministic REST snapshot",
    helperText: "This chat is rule-based and read-only. Ask for overdue tasks, workload hotspots, or a weekly summary.",
    suggestions: [
        "Give me a workspace summary",
        "What is overdue right now?",
        "Who has the heaviest workload?",
    ],
};

export function ClickUpAssistantScreen() {
    const [primer, setPrimer] = useState<PrimerResponse>(DEFAULT_PRIMER);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "assistant-welcome",
            role: "assistant",
            title: "ClickUp Assistant",
            body: DEFAULT_PRIMER.helperText,
        },
    ]);
    const [input, setInput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let active = true;

        fetch("/api/clickup-assistant", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error("Failed to load the assistant primer.");
                }
                return response.json();
            })
            .then((data: PrimerResponse) => {
                if (!active) return;
                setPrimer(data);
                setMessages([
                    {
                        id: "assistant-welcome",
                        role: "assistant",
                        title: "ClickUp Assistant",
                        body: data.helperText,
                    },
                ]);
            })
            .catch(() => {
                if (!active) return;
                setPrimer(DEFAULT_PRIMER);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [messages, isPending]);

    const sendMessage = (nextMessage: string) => {
        const trimmed = nextMessage.trim();
        if (!trimmed || isPending) return;

        setError(null);
        setInput("");
        setMessages((prev) => [
            ...prev,
            {
                id: `user-${Date.now()}`,
                role: "user",
                body: trimmed,
            },
        ]);

        startTransition(() => {
            void (async () => {
                try {
                    const response = await fetch("/api/clickup-assistant", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ message: trimmed }),
                    });

                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(String(data?.error || "Assistant request failed."));
                    }

                    const reply = data as AssistantReply;
                    setPrimer((prev) => ({
                        ...prev,
                        providerLabel: reply.meta.providerLabel,
                        suggestions: reply.suggestions,
                    }));
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `assistant-${Date.now()}`,
                            role: "assistant",
                            title: reply.title,
                            body: reply.summary,
                            bullets: reply.bullets,
                            meta: `${reply.meta.windowLabel} · ${reply.meta.taskCount} tasks · ${reply.meta.timeEntryCount} time entries`,
                        },
                    ]);
                } catch (err) {
                    const message = err instanceof Error ? err.message : "Assistant request failed.";
                    setError(message);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `assistant-error-${Date.now()}`,
                            role: "assistant",
                            title: "Assistant unavailable",
                            body: "I could not complete that request just now. The existing REST dashboard is still intact.",
                        },
                    ]);
                }
            })();
        });
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        sendMessage(input);
    };

    return (
        <section className="flex h-full min-h-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-surface/40 shadow-card">
            <div className="border-b border-border/80 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                                <MessageSquareText className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-text-main">ClickUp Chat</h2>
                                <div className="text-sm text-text-muted">{primer.providerLabel}</div>
                            </div>
                        </div>
                        <p className="max-w-3xl text-sm leading-6 text-text-muted">
                            Ask for workspace summaries, overdue work, blocked items, or weekly time signals.
                            This screen does not embed an LLM. It uses deterministic rule-based logic over the existing ClickUp REST snapshot.
                        </p>
                    </div>
                    <div className="rounded-full border border-border px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">
                        No LLM
                    </div>
                </div>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="flex min-h-0 flex-col border-r border-border/70">
                    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-6 custom-scrollbar">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={message.role === "assistant" ? "max-w-4xl" : "ml-auto max-w-2xl"}
                            >
                                <div
                                    className={
                                        message.role === "assistant"
                                            ? "rounded-3xl border border-border bg-background/70 px-4 py-4 text-sm leading-6 text-text-main"
                                            : "rounded-3xl border border-primary/30 bg-primary/12 px-4 py-4 text-sm leading-6 text-white"
                                    }
                                >
                                    {message.title && (
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                                            {message.title}
                                        </div>
                                    )}
                                    <div>{message.body}</div>
                                    {Array.isArray(message.bullets) && message.bullets.length > 0 && (
                                        <div className="mt-3 space-y-2 text-text-muted">
                                            {message.bullets.map((bullet, index) => (
                                                <div key={`${message.id}-${index}`} className="flex gap-2">
                                                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                                    <span>{bullet}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {message.meta && (
                                        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-text-muted/80">
                                            {message.meta}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isPending && (
                            <div className="max-w-3xl rounded-3xl border border-border bg-background/70 px-4 py-4 text-sm text-text-muted">
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                    Pulling the latest ClickUp snapshot...
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-border/80 bg-background/70 px-6 py-5">
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <textarea
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                rows={4}
                                placeholder="Ask about overdue work, capacity, blocked tasks, or this week's time..."
                                className="w-full resize-none rounded-2xl border border-border bg-background/90 px-4 py-3 text-sm text-text-main outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
                            />
                            <div className="flex items-center justify-between gap-4">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
                                    Rule-based ClickUp analysis
                                </div>
                                <button
                                    type="submit"
                                    disabled={isPending || !input.trim()}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    Ask ClickUp
                                </button>
                            </div>
                        </form>
                        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
                    </div>
                </div>

                <aside className="border-t border-border/70 bg-background/60 px-5 py-5 lg:border-l lg:border-t-0">
                    <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                        Suggested Prompts
                    </div>
                    <div className="space-y-2">
                        {primer.suggestions.slice(0, 3).map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => sendMessage(suggestion)}
                                className="w-full rounded-2xl border border-border bg-surface/80 px-4 py-3 text-left text-sm text-text-main transition-colors hover:border-primary/40 hover:bg-surface-hover"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                    <div className="mt-6 rounded-2xl border border-border bg-surface/60 px-4 py-4">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                            How This Works
                        </div>
                        <p className="text-sm leading-6 text-text-muted">
                            The dashboard reads ClickUp through the existing REST integration. This screen keeps chat strictly read-only and deterministic, with no model call embedded in the product.
                        </p>
                    </div>
                </aside>
            </div>
        </section>
    );
}
