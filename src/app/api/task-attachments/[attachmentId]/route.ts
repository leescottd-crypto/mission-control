import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function getTaskAttachmentStorageDir() {
    return path.join(process.cwd(), ".task-attachments");
}

export async function GET(
    _request: Request,
    context: { params: { attachmentId: string } }
) {
    const taskAttachmentModel = (prisma as any).taskAttachment;
    if (!taskAttachmentModel) {
        return NextResponse.json({ error: "Task attachments are not available yet." }, { status: 500 });
    }

    const attachmentId = String(context.params.attachmentId || "").trim();
    if (!attachmentId) {
        return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }

    const attachment = await taskAttachmentModel.findUnique({
        where: { id: attachmentId },
    });
    if (!attachment) {
        return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }

    try {
        const filePath = path.join(getTaskAttachmentStorageDir(), String(attachment.storedName));
        const file = await readFile(filePath);

        return new NextResponse(file, {
            headers: {
                "Content-Type": String(attachment.mimeType || "application/octet-stream"),
                "Content-Length": String(file.byteLength),
                "Content-Disposition": `inline; filename="${String(attachment.originalName || "attachment")}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return NextResponse.json({ error: "Attachment file is missing." }, { status: 404 });
    }
}
