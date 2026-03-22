"use client";

import { signIn } from "next-auth/react";

interface SignInScreenProps {
    callbackUrl: string;
    authEnabled: boolean;
    googleConfigured: boolean;
    inviteEmail?: string | null;
    inviteFirstName?: string | null;
    inviteExpired?: boolean;
    error?: string | null;
}

function getErrorMessage(error?: string | null) {
    if (error === "AccessDenied") {
        return "Your email address has not been granted access yet. Ask an admin to invite you first.";
    }
    return null;
}

export function SignInScreen({
    callbackUrl,
    authEnabled,
    googleConfigured,
    inviteEmail = null,
    inviteFirstName = null,
    inviteExpired = false,
    error = null,
}: SignInScreenProps) {
    const errorMessage = getErrorMessage(error);

    return (
        <div className="min-h-screen w-full bg-background text-text-main flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-2xl border border-border/60 bg-surface/70 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
                <div className="border-b border-border/50 px-6 py-5">
                    <div className="text-xl font-semibold text-white">Mission Control Sign In</div>
                    <div className="mt-2 text-sm text-text-muted">
                        Sign in with your Google credentials to access the workspace.
                    </div>
                </div>

                <div className="px-6 py-5 space-y-4">
                    {inviteEmail && !inviteExpired && (
                        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-slate-100">
                            {inviteFirstName ? `${inviteFirstName}, ` : ""}your access is ready for <span className="font-medium text-white">{inviteEmail}</span>.
                        </div>
                    )}

                    {inviteExpired && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            This invite link has expired. Ask an admin to resend your access email.
                        </div>
                    )}

                    {errorMessage && (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                            {errorMessage}
                        </div>
                    )}

                    {!authEnabled && (
                        <div className="rounded-xl border border-border/50 bg-background/60 px-4 py-3 text-sm text-text-muted">
                            Authentication is currently disabled for this environment. Set <code>AUTH_ENABLED=true</code> to enforce Google sign-in.
                        </div>
                    )}

                    {authEnabled && !googleConfigured && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            Google sign-in is not fully configured yet. Add the Google auth environment variables before turning this on for the team.
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => signIn("google", { callbackUrl }, inviteEmail ? { login_hint: inviteEmail } : undefined)}
                        disabled={!authEnabled || !googleConfigured || inviteExpired}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-border/70 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Continue With Google
                    </button>
                </div>
            </div>
        </div>
    );
}
