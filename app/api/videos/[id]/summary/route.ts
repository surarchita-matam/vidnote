import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSummary } from "@/lib/ai";
import { withApi, ApiError } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

export const maxDuration = 30;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    const video = await prisma.video.findUnique({
      where: { id },
      include: {
        annotations: { orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!video || video.userId !== user.id) throw new ApiError("Not found", 404);
    if (video.annotations.length === 0) {
      throw new ApiError("Add at least one annotation before generating a summary.");
    }

    const lines = video.annotations
      .map(
        (a: { timestamp: number; text: string }) =>
          `${formatDuration(a.timestamp)} — ${a.text.replace(/\s+/g, " ").trim()}`
      )
      .join("\n");

    const prompt = `You are summarizing a video based on the user's annotations.

Video: "${video.name}"
Duration: ${formatDuration(video.durationSeconds)}
Frame interval: ${video.frameIntervalSec}s

Annotations (timestamp → note):
${lines}

Write a 3-5 sentence narrative summary of what happens in the video, in chronological order. Use natural prose (no bullet lists). Reference timestamps inline as (mm:ss) where it adds clarity. Do not invent details that aren't supported by the annotations.`;

    const text = await generateSummary(prompt);

    const updated = await prisma.video.update({
      where: { id },
      data: { summary: text },
    });
    return { summary: updated.summary };
  });
}
