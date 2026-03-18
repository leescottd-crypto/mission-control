import { NextRequest, NextResponse } from "next/server";

import { askClickUpAssistant, getClickUpAssistantPrimer } from "@/lib/clickup-assistant";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json(getClickUpAssistantPrimer(), {
        headers: {
            "Cache-Control": "no-store",
            "X-Mission-Control-Chat-Mode": "rules-only",
        },
    });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const message = String(body?.message || "").trim();

        if (!message) {
            return NextResponse.json(
                { error: "Message is required." },
                {
                    status: 400,
                    headers: {
                        "Cache-Control": "no-store",
                        "X-Mission-Control-Chat-Mode": "rules-only",
                    },
                }
            );
        }

        const reply = await askClickUpAssistant(message);
        return NextResponse.json(reply, {
            headers: {
                "Cache-Control": "no-store",
                "X-Mission-Control-Chat-Mode": "rules-only",
            },
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Unknown assistant error",
            },
            {
                status: 500,
                headers: {
                    "Cache-Control": "no-store",
                    "X-Mission-Control-Chat-Mode": "rules-only",
                },
            }
        );
    }
}
