import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { UploadModal } from "@/components/upload-modal";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatRelativeDate } from "@/lib/utils";
import { Film } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const videos = await prisma.video.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      durationSeconds: true,
      status: true,
      sourceType: true,
      createdAt: true,
    },
  });

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your videos</h1>
          <p className="text-sm text-muted-foreground">
            Upload a video or paste a URL to start annotating.
          </p>
        </div>
        <UploadModal />
      </div>

      <div className="mt-8">
        {videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <Film className="h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-medium">No videos yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload your first video or paste a public URL to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Duration</th>
                  <th className="px-4 py-3 text-left font-medium">Uploaded</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/videos/${v.id}`} className="font-medium hover:underline">
                        {v.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {v.sourceType === "s3" ? "Uploaded" : "URL"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatDuration(v.durationSeconds)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeDate(v.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={v.status === "ready" ? "success" : "warning"}>
                        {v.status === "ready" ? "Ready" : "Processing"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
