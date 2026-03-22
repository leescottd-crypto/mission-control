import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getNetSuiteConfigFromEnv, getNetSuiteConsultantPathFromEnv, syncNetSuiteConsultants } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

const syncRequestSchema = z.object({
    dryRun: z.boolean().optional(),
    path: z.string().trim().min(1).optional(),
});

function getSyncTokenFromRequest(request: NextRequest): string {
    const authHeader = String(request.headers.get("authorization") || "").trim();
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }
    return String(request.headers.get("x-sync-token") || "").trim();
}

function isSyncAuthorized(request: NextRequest): boolean {
    const expected = String(process.env.NETSUITE_SYNC_TOKEN || "").trim();
    if (!expected) return true;
    return getSyncTokenFromRequest(request) === expected;
}

export async function GET() {
    const { missing } = getNetSuiteConfigFromEnv();

    return NextResponse.json(
        {
            ok: missing.length === 0,
            consultantPath: getNetSuiteConsultantPathFromEnv(),
            missing,
            syncTokenConfigured: Boolean(String(process.env.NETSUITE_SYNC_TOKEN || "").trim()),
        },
        {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
            },
        }
    );
}

export async function POST(request: NextRequest) {
    if (!isSyncAuthorized(request)) {
        return NextResponse.json(
            {
                ok: false,
                message: "Unauthorized NetSuite sync request",
            },
            {
                status: 401,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    let payload: z.infer<typeof syncRequestSchema> = {};
    try {
        const body = await request.json().catch(() => ({}));
        payload = syncRequestSchema.parse(body);
    } catch (error: any) {
        return NextResponse.json(
            {
                ok: false,
                message: String(error?.message || "Invalid sync request body"),
            },
            {
                status: 400,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    const result = await syncNetSuiteConsultants({
        path: payload.path,
        dryRun: payload.dryRun,
    });

    if (result.ok && !result.dryRun) {
        revalidatePath("/");
    }

    return NextResponse.json(result, {
        status: result.ok ? 200 : result.status >= 400 ? result.status : 502,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}
