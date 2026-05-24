import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApi, ApiError } from "@/lib/api";

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
    const body = (await req.json()) as { frameIntervalSec?: number; name?: string };
    const data: Record<string, unknown> = {};
    if (body.frameIntervalSec !== undefined) {
      if (![1, 5, 10].includes(body.frameIntervalSec)) {
        throw new ApiError("frameIntervalSec must be 1, 5, or 10");
      }
      data.frameIntervalSec = body.frameIntervalSec;
    }
    if (body.name !== undefined) data.name = body.name.slice(0, 200);
    const video = await prisma.video.update({ where: { id }, data });
    return { video };
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    await ownedVideo(user.id, id);
    await prisma.video.delete({ where: { id } });
    return { ok: true };
  });
}
