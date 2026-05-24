"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDuration, cn } from "@/lib/utils";

type Kind = "timestamp" | "frame";

interface Annotation {
  id: string;
  timestamp: number;
  text: string;
  kind: Kind;
  slotIndex: number | null;
}

interface VideoMeta {
  id: string;
  name: string;
  sourceType: string;
  durationSeconds: number;
  frameIntervalSec: number;
  summary: string | null;
}

interface Props {
  video: VideoMeta;
  initialAnnotations: Annotation[];
  playbackUrl: string;
}

export function VideoWorkspace({ video, initialAnnotations, playbackUrl }: Props) {
  const router = useRouter();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [annotations, setAnnotations] = React.useState<Annotation[]>(initialAnnotations);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(video.durationSeconds || 0);
  const [interval, setIntervalState] = React.useState<number>(video.frameIntervalSec);
  const [summary, setSummary] = React.useState<string | null>(video.summary);
  const [summaryBusy, setSummaryBusy] = React.useState(false);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete video");
      }
      setConfirmOpen(false);
      router.push("/");
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete video");
      setDeleting(false);
    }
  }

  const timestampAnnotations = React.useMemo(
    () => annotations.filter((a) => a.kind === "timestamp").sort((a, b) => a.timestamp - b.timestamp),
    [annotations]
  );

  const frameAnnotations = React.useMemo(() => {
    const map = new Map<number, Annotation>();
    for (const a of annotations) {
      if (a.kind === "frame" && a.slotIndex !== null) map.set(a.slotIndex, a);
    }
    return map;
  }, [annotations]);

  function seek(t: number) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration || video.durationSeconds, t));
    el.focus();
    void el.play();
  }

  async function addTimestampAnnotation(text: string) {
    const ts = videoRef.current?.currentTime ?? currentTime;
    const optimistic: Annotation = {
      id: `tmp-${Date.now()}`,
      timestamp: ts,
      text,
      kind: "timestamp",
      slotIndex: null,
    };
    setAnnotations((prev) => [...prev, optimistic]);
    const res = await fetch(`/api/videos/${video.id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: ts, text, kind: "timestamp" }),
    });
    if (res.ok) {
      const { annotation } = (await res.json()) as { annotation: Annotation };
      setAnnotations((prev) => prev.map((a) => (a.id === optimistic.id ? annotation : a)));
    } else {
      setAnnotations((prev) => prev.filter((a) => a.id !== optimistic.id));
    }
  }

  async function deleteAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/videos/${video.id}/annotations/${id}`, { method: "DELETE" });
  }

  async function saveFrameAnnotation(slotIndex: number, text: string) {
    const ts = slotIndex * interval;
    const existing = frameAnnotations.get(slotIndex);
    if (!text.trim()) {
      if (existing) await deleteAnnotation(existing.id);
      return;
    }
    if (existing && existing.text === text) return;
    const res = await fetch(`/api/videos/${video.id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: ts, text, kind: "frame", slotIndex }),
    });
    if (res.ok) {
      const { annotation } = (await res.json()) as { annotation: Annotation };
      setAnnotations((prev) => {
        const filtered = prev.filter(
          (a) => !(a.kind === "frame" && a.slotIndex === slotIndex)
        );
        return [...filtered, annotation];
      });
    }
  }

  async function changeInterval(newInterval: number) {
    setIntervalState(newInterval);
    await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameIntervalSec: newInterval }),
    });
  }

  async function generateSummary() {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}/summary`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSummary(data.summary as string);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSummaryBusy(false);
    }
  }

  const totalSlots = Math.max(1, Math.ceil((duration || video.durationSeconds) / interval) + 1);
  const slotIndices = React.useMemo(
    () => Array.from({ length: totalSlots }, (_, i) => i),
    [totalSlots]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="space-y-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All videos
          </Link>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">{video.name}</h1>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setDeleteError(null);
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
        <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this video?</DialogTitle>
              <DialogDescription>
                This permanently removes the video, its annotations, and the uploaded file.
                This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <div className="text-sm text-destructive">{deleteError}</div>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={deleting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="overflow-hidden rounded-xl border bg-black">
          <video
            ref={videoRef}
            src={playbackUrl}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-black"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (!Number.isFinite(d)) return;
              setDuration(d);
              // Backfill duration on the server if upload skipped it for speed.
              if (!video.durationSeconds || video.durationSeconds <= 0) {
                fetch(`/api/videos/${video.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ durationSeconds: d }),
                }).catch(() => {});
              }
            }}
          />
        </div>
        <Timeline
          duration={duration || video.durationSeconds}
          currentTime={currentTime}
          annotations={timestampAnnotations}
          onSeek={seek}
        />
        <div className="text-xs text-muted-foreground">
          Current: <span className="font-mono">{formatDuration(currentTime)}</span> /{" "}
          <span className="font-mono">{formatDuration(duration || video.durationSeconds)}</span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <Tabs defaultValue="annotations">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="annotations">Notes</TabsTrigger>
            <TabsTrigger value="frames">Frames</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>
          <TabsContent value="annotations" className="mt-4 space-y-4">
            <AddTimestampForm
              currentTime={currentTime}
              onSubmit={addTimestampAnnotation}
            />
            {timestampAnnotations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No annotations yet. Pause the video at an interesting moment and add a note.
              </p>
            ) : (
              <ul className="space-y-2">
                {timestampAnnotations.map((a) => (
                  <li
                    key={a.id}
                    className="group flex items-start gap-2 rounded-md border bg-background p-2 hover:bg-accent/50"
                  >
                    <button
                      onClick={() => seek(a.timestamp)}
                      className="shrink-0 rounded bg-secondary px-2 py-1 font-mono text-xs hover:bg-secondary/80"
                    >
                      {formatDuration(a.timestamp)}
                    </button>
                    <p className="flex-1 text-sm">{a.text}</p>
                    <button
                      onClick={() => deleteAnnotation(a.id)}
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                      aria-label="Delete annotation"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="frames" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Frame interval</label>
              <select
                value={interval}
                onChange={(e) => changeInterval(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value={1}>Every 1s</option>
                <option value={5}>Every 5s</option>
                <option value={10}>Every 10s</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              {totalSlots} slots auto-generated. Click a timestamp to jump there.
            </p>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {slotIndices.map((i) => {
                const ts = i * interval;
                const existing = frameAnnotations.get(i);
                return (
                  <FrameSlot
                    key={`${interval}-${i}`}
                    slotIndex={i}
                    timestamp={ts}
                    initialText={existing?.text ?? ""}
                    onSeek={() => seek(ts)}
                    onSave={(text) => saveFrameAnnotation(i, text)}
                  />
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="summary" className="mt-4 space-y-3">
            <Button
              onClick={generateSummary}
              disabled={summaryBusy || annotations.length === 0}
              className="w-full"
            >
              {summaryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles />}
              {summary ? "Regenerate" : "Generate summary"}
            </Button>
            {annotations.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add at least one annotation first.
              </p>
            )}
            {summaryError && (
              <p className="text-sm text-destructive">{summaryError}</p>
            )}
            {summary && (
              <div className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm leading-relaxed">
                {summary}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AddTimestampForm({
  currentTime,
  onSubmit,
}: {
  currentTime: number;
  onSubmit: (text: string) => Promise<void> | void;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          await onSubmit(text.trim());
          setText("");
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Note at{" "}
          <span className="font-mono">{formatDuration(currentTime)}</span>
        </span>
      </div>
      <Textarea
        placeholder="What's happening at this moment?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
      />
      <Button type="submit" size="sm" disabled={busy || !text.trim()}>
        <Plus className="h-4 w-4" />
        Add note
      </Button>
    </form>
  );
}

function FrameSlot({
  slotIndex,
  timestamp,
  initialText,
  onSeek,
  onSave,
}: {
  slotIndex: number;
  timestamp: number;
  initialText: string;
  onSeek: () => void;
  onSave: (text: string) => Promise<void> | void;
}) {
  const [text, setText] = React.useState(initialText);
  React.useEffect(() => setText(initialText), [initialText, slotIndex]);

  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-center justify-between">
        <button
          onClick={onSeek}
          className="rounded bg-secondary px-2 py-1 font-mono text-xs hover:bg-secondary/80"
        >
          {formatDuration(timestamp)}
        </button>
        {text !== initialText && (
          <span className="text-[10px] text-muted-foreground">unsaved</span>
        )}
      </div>
      <Textarea
        className="mt-2 min-h-[40px] resize-none"
        placeholder="Add a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== initialText) void onSave(text);
        }}
        rows={1}
      />
    </div>
  );
}

function Timeline({
  duration,
  currentTime,
  annotations,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  annotations: Annotation[];
  onSeek: (t: number) => void;
}) {
  if (!duration || duration <= 0) return null;
  return (
    <div className="relative h-6 select-none">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/60"
        style={{ width: `${Math.min(100, (currentTime / duration) * 100)}%` }}
      />
      {annotations.map((a) => (
        <button
          key={a.id}
          onClick={() => onSeek(a.timestamp)}
          title={`${formatDuration(a.timestamp)} — ${a.text}`}
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-amber-500 transition-transform hover:scale-125"
          )}
          style={{ left: `${(a.timestamp / duration) * 100}%` }}
        />
      ))}
    </div>
  );
}
