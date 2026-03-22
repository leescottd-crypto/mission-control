import { redirect } from "next/navigation";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { getRolePrivileges, normalizeAppRole, roleCan, type AppRole } from "@/lib/access";

export const isAuthEnabled = process.env.AUTH_ENABLED === "true";

const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const bootstrapAdminEmail = normalizeEmail(process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL || "");

export const isGoogleConfigured = Boolean(googleClientId && googleClientSecret);

function normalizeEmail(value: string) {
    return String(value || "").trim().toLowerCase();
}

function splitName(name: string | null | undefined) {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
        return { firstName: "", lastName: "" };
    }
    const parts = trimmed.split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
    };
}

async function ensureAuthorizedGoogleUser(input: {
    email: string;
    fullName: string;
    googleSubject?: string | null;
}) {
    const email = normalizeEmail(input.email);
    if (!email) return null;

    let appUser = await prisma.appUser.findUnique({
        where: { email },
    });

    if (!appUser) {
        const existingCount = await prisma.appUser.count();
        if (existingCount === 0 && bootstrapAdminEmail && email === bootstrapAdminEmail) {
            const name = splitName(input.fullName);
            appUser = await prisma.appUser.create({
                data: {
                    firstName: name.firstName || "Admin",
                    lastName: name.lastName || "User",
                    email,
                    role: "admin",
                    status: "active",
                    googleSubject: input.googleSubject ? String(input.googleSubject) : null,
                    invitedAt: new Date(),
                    inviteAcceptedAt: new Date(),
                    lastLoginAt: new Date(),
                },
            });
        }
    }

    if (!appUser || String(appUser.status) === "disabled") {
        return null;
    }

    const name = splitName(input.fullName);
    return await prisma.appUser.update({
        where: { email },
        data: {
            firstName: name.firstName || appUser.firstName,
            lastName: name.lastName || appUser.lastName,
            googleSubject: input.googleSubject ? String(input.googleSubject) : appUser.googleSubject,
            status: "active",
            inviteAcceptedAt: appUser.inviteAcceptedAt ?? new Date(),
            lastLoginAt: new Date(),
        },
    });
}

async function loadUserByEmail(email: string | null | undefined) {
    const normalized = normalizeEmail(email || "");
    if (!normalized) return null;
    return prisma.appUser.findUnique({
        where: { email: normalized },
    });
}

export const authOptions: NextAuthOptions = {
    secret: process.env.NEXTAUTH_SECRET,
    providers: isGoogleConfigured
        ? [
            GoogleProvider({
                clientId: googleClientId,
                clientSecret: googleClientSecret,
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
        async signIn({ user, account, profile }) {
            if (!isAuthEnabled) return true;
            if (account?.provider !== "google") return false;

            const email = normalizeEmail(user.email ?? String((profile as { email?: string } | undefined)?.email ?? ""));
            const fullName = String(user.name ?? (profile as { name?: string } | undefined)?.name ?? "").trim();
            const appUser = await ensureAuthorizedGoogleUser({
                email,
                fullName,
                googleSubject: account.providerAccountId,
            });

            return appUser ? true : "/signin?error=AccessDenied";
        },
        async jwt({ token, user, account, trigger }) {
            const lookupEmail = normalizeEmail(String(user?.email ?? token.email ?? ""));
            if ((account?.provider === "google" || trigger === "update") && lookupEmail) {
                const appUser = await loadUserByEmail(lookupEmail);
                if (appUser) {
                    token.email = appUser.email;
                    token.name = `${appUser.firstName} ${appUser.lastName}`.trim();
                    token.role = normalizeAppRole(appUser.role);
                    token.appUserId = appUser.id;
                    token.appUserStatus = appUser.status;
                }
            } else if (!token.role && lookupEmail) {
                const appUser = await loadUserByEmail(lookupEmail);
                if (appUser) {
                    token.role = normalizeAppRole(appUser.role);
                    token.appUserId = appUser.id;
                    token.appUserStatus = appUser.status;
                }
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = String(token.appUserId ?? token.sub ?? "");
                session.user.email = normalizeEmail(String(token.email ?? session.user.email ?? ""));
                session.user.name = String(token.name ?? session.user.name ?? "").trim();
                session.user.role = normalizeAppRole(String(token.role ?? "member"));
                session.user.privileges = getRolePrivileges(session.user.role);
            }
            return session;
        },
    },
};

export async function getAppSession() {
    if (!isAuthEnabled) return null;
    return getServerSession(authOptions);
}

export async function requireAppSession() {
    if (!isAuthEnabled) return null;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        redirect("/signin");
    }
    return session;
}

export async function requireAdminSession() {
    const session = await requireAppSession();
    if (!isAuthEnabled) return null;
    const role = normalizeAppRole(String(session?.user?.role ?? "member"));
    if (!roleCan(role, "manage_users")) {
        redirect("/");
    }
    return session;
}

export async function getCurrentAppUserRole(): Promise<AppRole | null> {
    const session = await getAppSession();
    if (!session?.user?.role) return null;
    return normalizeAppRole(String(session.user.role));
}
