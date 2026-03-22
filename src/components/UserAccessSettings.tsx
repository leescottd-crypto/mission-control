"use client";

import { useMemo, useState, useTransition } from "react";
import { Mail, RefreshCcw, Shield, UserPlus } from "lucide-react";
import { inviteAppUser, type AppUserRecord, type ConsultantRecord, updateAppUserRole, resendAppUserInvite } from "@/app/actions";
import { APP_ROLE_ORDER, ROLE_DEFINITIONS, type AppRole } from "@/lib/access";

interface UserAccessSettingsProps {
    initialUsers: AppUserRecord[];
    consultantDirectory: ConsultantRecord[];
    currentUserName: string;
    authEnabled: boolean;
}

function normalizeRosterKey(value: string) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function UserAccessSettings({ initialUsers, consultantDirectory, currentUserName, authEnabled }: UserAccessSettingsProps) {
    const [users, setUsers] = useState<AppUserRecord[]>(initialUsers);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<AppRole>("member");
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const consultantDirectoryByEmail = useMemo(() => {
        const byEmail = new Map<string, ConsultantRecord>();
        consultantDirectory.forEach((consultant) => {
            const emailKey = String(consultant.email || "").trim().toLowerCase();
            if (!emailKey) return;
            byEmail.set(emailKey, consultant);
        });
        return byEmail;
    }, [consultantDirectory]);

    const consultantDirectoryByName = useMemo(() => {
        const byName = new Map<string, ConsultantRecord>();
        consultantDirectory.forEach((consultant) => {
            byName.set(normalizeRosterKey(consultant.fullName), consultant);
        });
        return byName;
    }, [consultantDirectory]);

    const rosterMatchedUsers = useMemo(() => {
        return users.filter((user) => {
            const emailKey = String(user.email || "").trim().toLowerCase();
            const nameKey = normalizeRosterKey(`${user.firstName} ${user.lastName}`);
            return consultantDirectoryByEmail.has(emailKey) || consultantDirectoryByName.has(nameKey);
        });
    }, [consultantDirectoryByEmail, consultantDirectoryByName, users]);

    const orderedUsers = useMemo(
        () => consultantDirectory
            .slice()
            .sort((a, b) => a.fullName.localeCompare(b.fullName))
            .flatMap((consultant) => {
                const emailKey = String(consultant.email || "").trim().toLowerCase();
                const nameKey = normalizeRosterKey(consultant.fullName);
                const matchedUser = rosterMatchedUsers.find((user) => {
                    const userEmailKey = String(user.email || "").trim().toLowerCase();
                    const userNameKey = normalizeRosterKey(`${user.firstName} ${user.lastName}`);
                    return (emailKey && userEmailKey === emailKey) || userNameKey === nameKey;
                });
                return matchedUser ? [matchedUser] : [];
            }),
        [consultantDirectory, rosterMatchedUsers]
    );

    const consultantSuggestions = useMemo(() => {
        const provisionedEmails = new Set(rosterMatchedUsers.map((user) => user.email.toLowerCase()));
        return consultantDirectory
            .filter((consultant) => consultant.email && !provisionedEmails.has(consultant.email.toLowerCase()))
            .sort((a, b) => a.fullName.localeCompare(b.fullName));
    }, [consultantDirectory, rosterMatchedUsers]);

    const handleInvite = () => {
        setFeedback(null);
        setError(null);
        startTransition(async () => {
            try {
                const consultantMatch = consultantDirectoryByEmail.get(email.trim().toLowerCase())
                    ?? consultantDirectoryByName.get(normalizeRosterKey(`${firstName} ${lastName}`));

                if (!consultantMatch) {
                    throw new Error("This person is not in Consultant Utilization yet. Add them there first.");
                }

                const result = await inviteAppUser({
                    firstName: consultantMatch.firstName || firstName,
                    lastName: consultantMatch.lastName || lastName,
                    email: consultantMatch.email || email,
                    role,
                    inviterName: currentUserName,
                });
                setUsers((prev) => {
                    const next = prev.filter((item) => item.email !== result.user.email);
                    next.push(result.user);
                    return next;
                });
                setFirstName("");
                setLastName("");
                setEmail("");
                setRole("member");
                setFeedback(result.emailSent ? "User created and invite email sent." : `User created, but email could not be sent: ${result.emailError}`);
            } catch (nextError: any) {
                setError(String(nextError?.message || "Could not create user."));
            }
        });
    };

    const handleRoleChange = (userId: string, nextRole: AppRole) => {
        setFeedback(null);
        setError(null);
        startTransition(async () => {
            try {
                const updated = await updateAppUserRole(userId, nextRole);
                setUsers((prev) => prev.map((user) => (user.id === userId ? updated : user)));
                setFeedback("Role updated.");
            } catch (nextError: any) {
                setError(String(nextError?.message || "Could not update role."));
            }
        });
    };

    const handleResendInvite = (userId: string) => {
        setFeedback(null);
        setError(null);
        startTransition(async () => {
            try {
                const result = await resendAppUserInvite(userId, currentUserName);
                setUsers((prev) => prev.map((user) => (user.id === result.user.id ? result.user : user)));
                setFeedback(result.emailSent ? "Invite email resent." : `Invite refreshed, but email could not be sent: ${result.emailError}`);
            } catch (nextError: any) {
                setError(String(nextError?.message || "Could not resend invite."));
            }
        });
    };

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6">
            <section className="rounded-2xl border border-border/60 bg-surface/70 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
                <div className="border-b border-border/50 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-primary" />
                        <div>
                            <h1 className="text-xl font-semibold text-white">User Access</h1>
                            <p className="mt-1 text-sm text-text-muted">
                                Create users, assign roles, and send Google sign-in invites.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.1fr,0.9fr]">
                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">First Name</span>
                                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary" />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Last Name</span>
                                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary" />
                            </label>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[1.3fr,0.7fr]">
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Email</span>
                                <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary" />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[11px] uppercase tracking-wider text-text-muted">Role</span>
                                <select value={role} onChange={(e) => setRole(e.target.value as AppRole)} className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary">
                                    {APP_ROLE_ORDER.map((roleOption) => (
                                        <option key={roleOption} value={roleOption}>
                                            {ROLE_DEFINITIONS[roleOption].label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <button
                            type="button"
                            onClick={handleInvite}
                            disabled={isPending || !firstName.trim() || !lastName.trim() || !email.trim()}
                            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary/25 disabled:opacity-60"
                        >
                            <UserPlus className="h-4 w-4" />
                            Create User And Send Invite
                        </button>
                        {feedback && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{feedback}</div>}
                        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
                    </div>

                    <div className="rounded-2xl border border-border/50 bg-background/50 p-4">
                        <div className="text-sm font-semibold text-white">Role Guide</div>
                        <div className="mt-3 space-y-3">
                            {APP_ROLE_ORDER.map((roleOption) => (
                                <div key={roleOption} className="rounded-xl border border-border/40 bg-white/[0.02] px-3 py-3">
                                    <div className="text-sm font-medium text-white">{ROLE_DEFINITIONS[roleOption].label}</div>
                                    <div className="mt-1 text-xs text-text-muted">{ROLE_DEFINITIONS[roleOption].description}</div>
                                </div>
                            ))}
                        </div>
                        {!authEnabled && (
                            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
                                Authentication is still off in this environment. Create your users here first, then turn on `AUTH_ENABLED=true`.
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-surface/70 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                <div className="border-b border-border/50 px-6 py-4">
                    <div className="text-sm font-semibold text-white">Suggested From Consultant Utilization</div>
                    <div className="mt-1 text-xs text-text-muted">
                        People with email addresses from the consultant roster who are not provisioned yet.
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border/40 bg-background/40 text-left text-[11px] uppercase tracking-wider text-text-muted">
                            <tr>
                                <th className="px-6 py-3">Consultant</th>
                                <th className="px-4 py-3">Email</th>
                                <th className="px-4 py-3 text-right">Add</th>
                            </tr>
                        </thead>
                        <tbody>
                            {consultantSuggestions.map((consultant) => (
                                <tr key={`${consultant.id}-${consultant.email}`} className="border-b border-border/30 text-text-main">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-white">{consultant.fullName}</div>
                                        <div className="text-xs text-text-muted">{consultant.source}</div>
                                    </td>
                                    <td className="px-4 py-4 text-text-muted">{consultant.email}</td>
                                    <td className="px-4 py-4 text-right">
                                        <button
                                            type="button"
                                            disabled={isPending}
                                            onClick={() => {
                                                setFirstName(consultant.firstName);
                                                setLastName(consultant.lastName);
                                                setEmail(consultant.email);
                                                setRole("member");
                                            }}
                                            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover disabled:opacity-60"
                                        >
                                            <UserPlus className="h-4 w-4" />
                                            Use In Form
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {consultantSuggestions.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="px-6 py-8 text-center text-sm text-text-muted">
                                        All consultants with email addresses are already available in user setup.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-surface/70 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                <div className="border-b border-border/50 px-6 py-4">
                    <div className="text-sm font-semibold text-white">Provisioned Users</div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border/40 bg-background/40 text-left text-[11px] uppercase tracking-wider text-text-muted">
                            <tr>
                                <th className="px-6 py-3">User</th>
                                <th className="px-4 py-3">Role</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Invite</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orderedUsers.map((user) => (
                                <tr key={user.id} className="border-b border-border/30 text-text-main">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-white">{user.firstName} {user.lastName}</div>
                                        <div className="text-xs text-text-muted">{user.email}</div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <select
                                            value={user.role}
                                            onChange={(e) => handleRoleChange(user.id, e.target.value as AppRole)}
                                            className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                        >
                                            {APP_ROLE_ORDER.map((roleOption) => (
                                                <option key={roleOption} value={roleOption}>
                                                    {ROLE_DEFINITIONS[roleOption].label}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-4 py-4">
                                        <span className="rounded-full border border-border/50 px-2 py-1 text-xs uppercase tracking-wider text-text-muted">
                                            {user.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-xs text-text-muted">
                                        {user.inviteSentAt ? new Date(user.inviteSentAt).toLocaleString() : "Not sent"}
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        <button
                                            type="button"
                                            onClick={() => handleResendInvite(user.id)}
                                            disabled={isPending}
                                            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover disabled:opacity-60"
                                        >
                                            {user.inviteAcceptedAt ? <RefreshCcw className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                                            {user.inviteAcceptedAt ? "Resend Access" : "Send Invite"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {orderedUsers.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-text-muted">
                                        No users have been provisioned yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
