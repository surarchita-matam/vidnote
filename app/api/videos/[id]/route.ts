import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApi, ApiError } from "@/lib/api";
import { deleteObject } from "@/lib/s3";

async function ownedVideo(userId: string, id: string) {
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.userId !== userId) throw new ApiError("Not found", 404);
  return video;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const video = await ownedVideo(user.id, id);
    const annotations = await prisma.annotation.findMany({
      where: { videoId: id },
      orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    });
    return { video, annotations };
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    await ownedVideo(user.id, id);
    const body = (await req.json()) as {
      frameIntervalSec?: number;
      name?: string;
      durationSeconds?: number;
    };
    const data: Record<string, unknown> = {};
    if (body.frameIntervalSec !== undefined) {
      if (![1, 5, 10].includes(body.frameIntervalSec)) {
        throw new ApiError("frameIntervalSec must be 1, 5, or 10");
      }
      data.frameIntervalSec = body.frameIntervalSec;
    }
    if (body.name !== undefined) data.name = body.name.slice(0, 200);
    if (body.durationSeconds !== undefined && Number.isFinite(body.durationSeconds)) {
      data.durationSeconds = Math.max(0, body.durationSeconds);
    }
    const video = await prisma.video.update({ where: { id }, data });
    return { video };
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const video = await ownedVideo(user.id, id);
    if (video.sourceType === "s3" && video.s3Key) {
      try {
        await deleteObject(video.s3Key);
      } catch (err) {
        // Don't block the row deletion on an S3 hiccup — orphaned blob is recoverable, undeletable row isn't.
        console.error(`Failed to delete S3 object ${video.s3Key}:`, err);
      }
    }
    await prisma.video.delete({ where: { id } });
    return { ok: true };
  });
}
