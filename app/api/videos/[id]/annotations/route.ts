import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApi, ApiError } from "@/lib/api";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video || video.userId !== user.id) throw new ApiError("Not found", 404);

    const body = (await req.json()) as {
      timestamp?: number;
      text?: string;
      kind?: "timestamp" | "frame";
      slotIndex?: number;
    };
    if (typeof body.timestamp !== "number" || !body.text || !body.kind) {
      throw new ApiError("timestamp, text, and kind are required");
    }
    if (body.kind !== "timestamp" && body.kind !== "frame") {
      throw new ApiError("kind must be 'timestamp' or 'frame'");
    }
    if (body.kind === "frame" && typeof body.slotIndex !== "number") {
      throw new ApiError("slotIndex required for frame annotations");
    }

    // For frame annotations, upsert behavior: replace text in existing slot.
    if (body.kind === "frame") {
      const existing = await prisma.annotation.findFirst({
        where: { videoId: id, kind: "frame", slotIndex: body.slotIndex },
      });
      if (existing) {
        const updated = await prisma.annotation.update({
          where: { id: existing.id },
          data: { text: body.text.slice(0, 2000), timestamp: body.timestamp },
        });
        return { annotation: updated };
      }
    }

    const annotation = await prisma.annotation.create({
      data: {
        videoId: id,
        timestamp: Math.max(0, body.timestamp),
        text: body.text.slice(0, 2000),
        kind: body.kind,
        slotIndex: body.kind === "frame" ? body.slotIndex! : null,
      },
    });
    return { annotation };
  });
}
