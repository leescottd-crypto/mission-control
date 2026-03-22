import type { DefaultSession } from "next-auth";
import type { AppPrivilege, AppRole } from "@/lib/access";

declare module "next-auth" {
    interface Session {
        user: DefaultSession["user"] & {
            id: string;
            role: AppRole;
            privileges: AppPrivilege[];
        };
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        role?: AppRole;
        appUserId?: string;
        appUserStatus?: string;
    }
}
