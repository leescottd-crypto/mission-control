import { SignInScreen } from "@/components/SignInScreen";
import { getAppUserInviteContext } from "@/app/actions";
import { isAuthEnabled, isGoogleConfigured } from "@/lib/auth";

export default async function SignInPage({
    searchParams,
}: {
    searchParams?: { callbackUrl?: string; invite?: string; email?: string; error?: string };
}) {
    const callbackUrl = typeof searchParams?.callbackUrl === "string" && searchParams.callbackUrl.trim().length > 0
        ? searchParams.callbackUrl
        : "/";
    const inviteContext = await getAppUserInviteContext({
        token: typeof searchParams?.invite === "string" ? searchParams.invite : undefined,
        email: typeof searchParams?.email === "string" ? searchParams.email : undefined,
    });
    const error = typeof searchParams?.error === "string" ? searchParams.error : "";

    return (
        <SignInScreen
            callbackUrl={callbackUrl}
            authEnabled={isAuthEnabled}
            googleConfigured={isGoogleConfigured}
            inviteEmail={inviteContext?.email ?? null}
            inviteFirstName={inviteContext?.firstName ?? null}
            inviteExpired={Boolean(inviteContext?.isExpired)}
            error={error}
        />
    );
}
