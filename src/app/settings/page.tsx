import { getAppUsers, syncClickUpConsultantsAndUsers } from "@/app/actions";
import { UserAccessSettings } from "@/components/UserAccessSettings";
import { getAppSession, isAuthEnabled, requireAdminSession } from "@/lib/auth";
import Link from "next/link";

function normalizeRosterKey(value: string) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export default async function SettingsPage() {
    if (isAuthEnabled) {
        await requireAdminSession();
    }

    const consultantRoster = await syncClickUpConsultantsAndUsers();

    const [users, session] = await Promise.all([
        getAppUsers(consultantRoster),
        getAppSession(),
    ]);
    const consultantEmails = new Set(
        consultantRoster
            .map((consultant) => String(consultant.email || "").trim().toLowerCase())
            .filter((email) => email.length > 0)
    );
    const consultantNames = new Set(
        consultantRoster.map((consultant) => normalizeRosterKey(consultant.fullName))
    );
    const filteredUsers = users.filter((user) => {
        const emailKey = String(user.email || "").trim().toLowerCase();
        const nameKey = normalizeRosterKey(`${user.firstName} ${user.lastName}`);
        return consultantEmails.has(emailKey) || consultantNames.has(nameKey);
    });

    const currentUserName = String(session?.user?.name || "Mission Control Admin").trim() || "Mission Control Admin";

    return (
        <main className="h-screen overflow-y-auto bg-background px-6 py-8 text-text-main">
            <div className="mx-auto mb-4 flex w-full max-w-6xl">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.08]"
                >
                    Back To Main Menu
                </Link>
            </div>
            <UserAccessSettings
                initialUsers={filteredUsers}
                consultantDirectory={consultantRoster}
                currentUserName={currentUserName}
                authEnabled={isAuthEnabled}
            />
        </main>
    );
}
