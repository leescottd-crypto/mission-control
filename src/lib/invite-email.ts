type SendInviteInput = {
    email: string;
    firstName: string;
    inviterName: string;
    inviteUrl: string;
    roleLabel: string;
};

function getAppBaseUrl() {
    return String(process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000").trim();
}

export function getInviteUrl(token: string, email: string) {
    const url = new URL("/signin", getAppBaseUrl());
    url.searchParams.set("invite", token);
    url.searchParams.set("email", email);
    url.searchParams.set("callbackUrl", "/");
    return url.toString();
}

export async function sendInviteEmail(input: SendInviteInput) {
    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
    if (!apiKey || !from) {
        return {
            ok: false,
            reason: "Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
        };
    }

    const appName = String(process.env.APP_NAME || "Mission Control").trim();
    const firstName = String(input.firstName || "").trim() || "there";
    const inviterName = String(input.inviterName || "").trim() || appName;

    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
            <h2 style="margin:0 0 16px;">You're invited to ${appName}</h2>
            <p>Hi ${firstName},</p>
            <p>${inviterName} created your ${appName} account with the <strong>${input.roleLabel}</strong> role.</p>
            <p>Use the button below to sign in with your Google credentials.</p>
            <p style="margin:24px 0;">
                <a href="${input.inviteUrl}" style="background:#111827;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;">
                    Sign In With Google
                </a>
            </p>
            <p>If the button does not work, open this link:</p>
            <p><a href="${input.inviteUrl}">${input.inviteUrl}</a></p>
        </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            to: [input.email],
            subject: `Your ${appName} access is ready`,
            html,
        }),
        cache: "no-store",
    });

    if (!response.ok) {
        const errorText = await response.text();
        return {
            ok: false,
            reason: errorText || `Invite email failed with status ${response.status}.`,
        };
    }

    return { ok: true as const };
}
