import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function getTaskAttachmentStorageDir() {
    return path.join(process.cwd(), ".task-attachments");
}

function sanitizeFileName(value: string) {
    const trimmed = String(value || "").trim();
    const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
    return safe || "attachment";
}

export async function POST(request: Request) {
    const taskAttachmentModel = (prisma as any).taskAttachment;
    const editableTaskModel = (prisma as any).editableTask;
    if (!taskAttachmentModel || !editableTaskModel) {
        return NextResponse.json({ error: "Task attachments are not available yet." }, { status: 500 });
    }

    const formData = await request.formData();
    const taskId = String(formData.get("taskId") ?? "").trim();
    const file = formData.get("file");

    if (!taskId) {
        return NextResponse.json({ error: "Task is required." }, { status: 400 });
    }
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "File is required." }, { status: 400 });
    }
    if (file.size <= 0) {
        return NextResponse.json({ error: "File is empty." }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "File exceeds the 15MB MVP limit." }, { status: 400 });
    }

    const task = await editableTaskModel.findUnique({
        where: { id: taskId },
    });
    if (!task) {
        return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    await mkdir(getTaskAttachmentStorageDir(), { recursive: true });

    const originalName = sanitizeFileName(file.name || "attachment");
    const storedName = `${Date.now()}-${randomBytes(8).toString("hex")}-${originalName}`;
    const targetPath = path.join(getTaskAttachmentStorageDir(), storedName);

    const bytes = await file.arrayBuffer();
    await writeFile(targetPath, Buffer.from(bytes));

    const created = await taskAttachmentModel.create({
        data: {
            taskId,
            originalName: originalName,
            storedName,
            mimeType: String(file.type || "application/octet-stream"),
            sizeBytes: Number(file.size || 0),
        },
    });

    return NextResponse.json({
        id: String(created.id),
        taskId: String(created.taskId),
        originalName: String(created.originalName ?? ""),
        storedName: String(created.storedName ?? ""),
        mimeType: String(created.mimeType ?? "application/octet-stream"),
        sizeBytes: Number(created.sizeBytes ?? 0),
        downloadUrl: `/api/task-attachments/${String(created.id)}`,
        createdAt: new Date(created.createdAt).toISOString(),
        updatedAt: new Date(created.updatedAt).toISOString(),
    });
}
