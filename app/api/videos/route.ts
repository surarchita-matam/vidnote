import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApi, ApiError } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const videos = await prisma.video.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sourceType: true,
        durationSeconds: true,
        status: true,
        createdAt: true,
      },
    });
    return { videos };
  });
}

export async function POST(req: NextRequest) {
  return withApi(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      name?: string;
      sourceType?: string;
      s3Key?: string;
      externalUrl?: string;
      durationSeconds?: number;
    };
    if (!body.name || !body.sourceType || typeof body.durationSeconds !== "number") {
      throw new ApiError("Missing required fields");
    }
    if (body.sourceType !== "s3" && body.sourceType !== "url") {
      throw new ApiError("sourceType must be 's3' or 'url'");
    }
    if (body.sourceType === "s3" && !body.s3Key) throw new ApiError("s3Key required");
    if (body.sourceType === "url" && !body.externalUrl) throw new ApiError("externalUrl required");

    const video = await prisma.video.create({
      data: {
        userId: user.id,
        name: body.name.slice(0, 200),
        sourceType: body.sourceType,
        s3Key: body.sourceType === "s3" ? body.s3Key : null,
        externalUrl: body.sourceType === "url" ? body.externalUrl : null,
        durationSeconds: Math.max(0, body.durationSeconds),
        status: "ready",
      },
    });
    return { video };
  });
}
