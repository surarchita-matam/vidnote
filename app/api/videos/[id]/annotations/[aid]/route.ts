import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApi, ApiError } from "@/lib/api";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; aid: string }> }
) {
  return withApi(async () => {
    const user = await requireUser();
    const { id, aid } = await ctx.params;
    const video = await prisma.video.findUnique({ where: { id } });
    if (!video || video.userId !== user.id) throw new ApiError("Not found", 404);
    const annotation = await prisma.annotation.findUnique({ where: { id: aid } });
    if (!annotation || annotation.videoId !== id) throw new ApiError("Not found", 404);
    await prisma.annotation.delete({ where: { id: aid } });
    return { ok: true };
  });
}
