"use client";

import { signIn } from "next-auth/react";

interface SignInScreenProps {
    callbackUrl: string;
    authEnabled: boolean;
    azureConfigured: boolean;
}

export function SignInScreen({ callbackUrl, authEnabled, azureConfigured }: SignInScreenProps) {
    return (
        <div className="min-h-screen w-full bg-background text-text-main flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-2xl border border-border/60 bg-surface/70 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
                <div className="border-b border-border/50 px-6 py-5">
                    <div className="text-xl font-semibold text-white">Mission Control Sign In</div>
                    <div className="mt-2 text-sm text-text-muted">
                        Sign in with Microsoft Entra ID to access the office dashboard.
                    </div>
                </div>

                <div className="px-6 py-5 space-y-4">
                    {!authEnabled && (
                        <div className="rounded-xl border border-border/50 bg-background/60 px-4 py-3 text-sm text-text-muted">
                            Authentication is currently disabled for this environment. Set <code>AUTH_ENABLED=true</code> to enforce office login.
                        </div>
                    )}

                    {authEnabled && !azureConfigured && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            Microsoft Entra ID is not fully configured yet. Add the Azure auth environment variables before turning this on for the office.
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => signIn("azure-ad", { callbackUrl })}
                        disabled={!authEnabled || !azureConfigured}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-border/70 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Continue With Microsoft
                    </button>
                </div>
            </div>
        </div>
    );
}
