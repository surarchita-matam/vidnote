"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, Link2, Loader2, FileVideo, X } from "lucide-react";
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

// Multipart tuning. S3 minimum part size is 5 MiB (except the last part).
// Bigger parts = fewer round-trips; smaller = better progress resolution. 16 MiB is a good middle.
const PART_SIZE = 16 * 1024 * 1024;
const CONCURRENCY = 4;
const MAX_PART_RETRIES = 3;
// If we can't read duration from the file within this window, skip it and backfill later.
const DURATION_READ_TIMEOUT_MS = 4000;

function readVideoDurationWithTimeout(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(0);
    setTimeout(() => finish(0), DURATION_READ_TIMEOUT_MS);
    video.src = url;
  });
}

function readUrlDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.muted = true;
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(0);
    setTimeout(() => finish(0), DURATION_READ_TIMEOUT_MS);
    video.src = url;
  });
}

interface PartUploadResult {
  ETag: string;
  PartNumber: number;
}

async function uploadPart(
  url: string,
  blob: Blob,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) {
          reject(new Error("S3 did not return an ETag. Check bucket CORS ExposeHeaders."));
          return;
        }
        resolve(etag.replace(/^"|"$/g, ""));
      } else {
        reject(new Error(`Part upload failed (status ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new Error("Aborted"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

async function multipartUpload(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<{ key: string }> {
  const startRes = await fetch("/api/videos/upload/multipart/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4" }),
  });
  if (!startRes.ok) throw new Error((await startRes.json()).error || "Failed to start upload");
  const { key, uploadId } = (await startRes.json()) as { key: string; uploadId: string };

  const totalParts = Math.max(1, Math.ceil(file.size / PART_SIZE));
  const partProgress = new Array<number>(totalParts).fill(0);
  const reportProgress = () => {
    const loaded = partProgress.reduce((s, n) => s + n, 0);
    onProgress(loaded, file.size);
  };

  const results: PartUploadResult[] = new Array(totalParts);
  let nextPart = 0;
  let aborted = false;

  async function worker() {
    while (!aborted) {
      const partIndex = nextPart++;
      if (partIndex >= totalParts) return;
      const partNumber = partIndex + 1;
      const start = partIndex * PART_SIZE;
      const end = Math.min(file.size, start + PART_SIZE);
      const blob = file.slice(start, end);

      let attempt = 0;
      let lastErr: unknown;
      while (attempt < MAX_PART_RETRIES) {
        try {
          const signRes = await fetch("/api/videos/upload/multipart/sign-part", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, uploadId, partNumber }),
          });
          if (!signRes.ok) throw new Error("Failed to sign part");
          const { url } = (await signRes.json()) as { url: string };
          const etag = await uploadPart(url, blob, signal);
          results[partIndex] = { ETag: etag, PartNumber: partNumber };
          partProgress[partIndex] = blob.size;
          reportProgress();
          break;
        } catch (err) {
          lastErr = err;
          attempt++;
          if (attempt >= MAX_PART_RETRIES) {
            aborted = true;
            throw lastErr;
          }
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, totalParts) }, () => worker())
    );
    const completeRes = await fetch("/api/videos/upload/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, parts: results }),
    });
    if (!completeRes.ok) {
      throw new Error((await completeRes.json()).error || "Failed to finalize upload");
    }
    return { key };
  } catch (err) {
    // Best-effort cleanup so we don't leave orphaned parts billing the bucket.
    fetch("/api/videos/upload/multipart/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId }),
    }).catch(() => {});
    throw err;
  }
}

export function UploadModal() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);

  const [file, setFile] = React.useState<File | null>(null);
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("Please choose a video file.");
      return;
    }
    setError(null);
    setFile(f);
  }

  function reset() {
    setBusy(false);
    setError(null);
    setProgress(0);
    setFile(null);
    setUrl("");
    setName("");
    abortRef.current = null;
  }

  async function handleFileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      // Kick off duration read and upload in parallel. Duration is best-effort
      // and bounded; we backfill from the video element later if it's 0.
      const durationPromise = readVideoDurationWithTimeout(file);

      const { key } = await multipartUpload(
        file,
        (loaded, total) => setProgress(loaded / total),
        ctl.signal
      );
      const duration = await durationPromise;

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
      const duration = await readUrlDuration(url);
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) {
          abortRef.current?.abort();
        }
        setOpen(o);
        if (!o) reset();
      }}
    >
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
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0])}
                disabled={busy}
              />
              {!file ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!busy) setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (busy) return;
                    acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  disabled={busy}
                  className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                    dragOver
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm font-medium">
                    Click to choose a video, or drag and drop
                  </div>
                  <div className="text-xs text-muted-foreground">
                    MP4, MOV, WebM and other video formats
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3">
                  <FileVideo className="h-8 w-8 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(file.size / 1_000_000).toFixed(1)} MB
                    </div>
                  </div>
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
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
                    Uploading {Math.round(progress * 100)}% — {CONCURRENCY} parts in parallel
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
