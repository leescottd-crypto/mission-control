export const APP_ROLE_ORDER = ["admin", "manager", "member", "viewer"] as const;

export type AppRole = (typeof APP_ROLE_ORDER)[number];

export type AppPrivilege =
    | "manage_users"
    | "manage_configuration"
    | "edit_workspace"
    | "edit_tasks"
    | "view_workspace";

export const ROLE_DEFINITIONS: Record<AppRole, { label: string; description: string; privileges: AppPrivilege[] }> = {
    admin: {
        label: "Admin",
        description: "Full workspace access, including user setup and office configuration.",
        privileges: ["manage_users", "manage_configuration", "edit_workspace", "edit_tasks", "view_workspace"],
    },
    manager: {
        label: "Manager",
        description: "Can update workspace planning, boards, and task operations.",
        privileges: ["manage_configuration", "edit_workspace", "edit_tasks", "view_workspace"],
    },
    member: {
        label: "Basic",
        description: "Standard day-to-day access for working boards, tasks, and planning.",
        privileges: ["edit_tasks", "view_workspace"],
    },
    viewer: {
        label: "Viewer",
        description: "Read-only access for visibility without edit rights.",
        privileges: ["view_workspace"],
    },
};

export function isAppRole(value: string): value is AppRole {
    return APP_ROLE_ORDER.includes(value as AppRole);
}

export function normalizeAppRole(value: string): AppRole {
    return isAppRole(String(value || "").trim().toLowerCase()) ? (String(value).trim().toLowerCase() as AppRole) : "member";
}

export function getRolePrivileges(role: string): AppPrivilege[] {
    return ROLE_DEFINITIONS[normalizeAppRole(role)].privileges;
}

export function roleCan(role: string, privilege: AppPrivilege) {
    return getRolePrivileges(role).includes(privilege);
}
