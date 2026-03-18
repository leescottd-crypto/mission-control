import { SignInScreen } from "@/components/SignInScreen";
import { isAuthEnabled, isAzureConfigured } from "@/lib/auth";

export default function SignInPage({
    searchParams,
}: {
    searchParams?: { callbackUrl?: string };
}) {
    const callbackUrl = typeof searchParams?.callbackUrl === "string" && searchParams.callbackUrl.trim().length > 0
        ? searchParams.callbackUrl
        : "/";

    return (
        <SignInScreen
            callbackUrl={callbackUrl}
            authEnabled={isAuthEnabled}
            azureConfigured={isAzureConfigured}
        />
    );
}
