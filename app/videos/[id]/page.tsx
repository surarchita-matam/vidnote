import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { presignGet } from "@/lib/s3";
import { AppShell } from "@/components/app-shell";
import { VideoWorkspace } from "@/components/video-workspace";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=/videos/${id}`);

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      annotations: { orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!video || video.userId !== session.user.id) notFound();

  let playbackUrl = video.externalUrl ?? "";
  if (video.sourceType === "s3" && video.s3Key) {
    playbackUrl = await presignGet(video.s3Key, 60 * 60);
  }

  return (
    <AppShell>
      <VideoWorkspace
        video={{
          id: video.id,
          name: video.name,
          sourceType: video.sourceType,
          durationSeconds: video.durationSeconds,
          frameIntervalSec: video.frameIntervalSec,
          summary: video.summary,
        }}
        initialAnnotations={video.annotations.map((a) => ({
          id: a.id,
          timestamp: a.timestamp,
          text: a.text,
          kind: a.kind as "timestamp" | "frame",
          slotIndex: a.slotIndex,
        }))}
        playbackUrl={playbackUrl}
      />
    </AppShell>
  );
}
