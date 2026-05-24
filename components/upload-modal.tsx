"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata."));
    };
    video.src = url;
  });
}

function readUrlDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => reject(new Error("Could not load video from URL."));
    video.src = url;
  });
}

async function uploadToS3(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 upload failed (status ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function UploadModal() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState(0);

  // File state
  const [file, setFile] = React.useState<File | null>(null);

  // URL state
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");

  function reset() {
    setBusy(false);
    setError(null);
    setProgress(0);
    setFile(null);
    setUrl("");
    setName("");
  }

  async function handleFileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const duration = await readVideoDuration(file);
      const presignRes = await fetch("/api/videos/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error((await presignRes.json()).error || "Presign failed");
      const { key, url: putUrl } = (await presignRes.json()) as { key: string; url: string };
      await uploadToS3(putUrl, file, setProgress);
      const createRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          sourceType: "s3",
          s3Key: key,
          durationSeconds: duration,
        }),
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error || "Save failed");
      const { video } = (await createRes.json()) as { video: { id: string } };
      setOpen(false);
      reset();
      router.push(`/videos/${video.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      let duration = 0;
      try {
        duration = await readUrlDuration(url);
      } catch {
        // Some URLs block CORS; default to 0 and let user know.
        duration = 0;
      }
      const finalName = name.trim() || url.split("/").pop()?.split("?")[0] || "Untitled";
      const createRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: finalName,
          sourceType: "url",
          externalUrl: url,
          durationSeconds: duration,
        }),
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error || "Save failed");
      const { video } = (await createRes.json()) as { video: { id: string } };
      setOpen(false);
      reset();
      router.push(`/videos/${video.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save URL");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Upload />
          Upload video
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a video</DialogTitle>
          <DialogDescription>
            Upload from your computer or paste a public video URL.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="file">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="file">
              <Upload className="h-4 w-4" />
              File
            </TabsTrigger>
            <TabsTrigger value="url">
              <Link2 className="h-4 w-4" />
              URL
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            <form onSubmit={handleFileSubmit} className="space-y-4 pt-2">
              <Input
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
                required
              />
              {file && (
                <div className="text-xs text-muted-foreground">
                  {file.name} — {(file.size / 1_000_000).toFixed(1)} MB
                </div>
              )}
              {busy && (
                <div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Uploading {Math.round(progress * 100)}%…
                  </div>
                </div>
              )}
              {error && <div className="text-sm text-destructive">{error}</div>}
              <Button type="submit" className="w-full" disabled={!file || busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Uploading…" : "Upload"}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="url">
            <form onSubmit={handleUrlSubmit} className="space-y-3 pt-2">
              <Input
                type="url"
                placeholder="https://example.com/video.mp4"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy}
                required
              />
              <Input
                placeholder="Display name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
              {error && <div className="text-sm text-destructive">{error}</div>}
              <Button type="submit" className="w-full" disabled={!url || busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Saving…" : "Add video"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
