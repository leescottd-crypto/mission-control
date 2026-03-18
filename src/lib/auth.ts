import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

export const isAuthEnabled = process.env.AUTH_ENABLED === "true";

const azureClientId = String(process.env.AZURE_AD_CLIENT_ID || "").trim();
const azureClientSecret = String(process.env.AZURE_AD_CLIENT_SECRET || "").trim();
const azureTenantId = String(process.env.AZURE_AD_TENANT_ID || "").trim();

export const isAzureConfigured = Boolean(azureClientId && azureClientSecret && azureTenantId);

export const authOptions: NextAuthOptions = {
    providers: isAzureConfigured
        ? [
            AzureADProvider({
                clientId: azureClientId,
                clientSecret: azureClientSecret,
                tenantId: azureTenantId,
            }),
        ]
        : [],
    pages: {
        signIn: "/signin",
    },
    session: {
        strategy: "jwt",
    },
    callbacks: {
        async session({ session, token }) {
            if (session.user) {
                (session.user as typeof session.user & { id?: string }).id = token.sub ?? "";
            }
            return session;
        },
    },
};
