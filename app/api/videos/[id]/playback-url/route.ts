import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { presignGet } from "@/lib/s3";
import { withApi, ApiError } from "@/lib/api";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const video = await prisma.video.findUnique({ where: { id } });
    if (!video || video.userId !== user.id) throw new ApiError("Not found", 404);

    if (video.sourceType === "s3" && video.s3Key) {
      const url = await presignGet(video.s3Key, 60 * 60);
      return { url };
    }
    if (video.sourceType === "url" && video.externalUrl) {
      return { url: video.externalUrl };
    }
    throw new ApiError("Video has no playable source", 500);
  });
}
