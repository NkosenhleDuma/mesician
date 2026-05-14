"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

const ACCEPT = [".gp", ".gp3", ".gp4", ".gp5", ".gpx"];
const ACCEPT_ATTR = ".gp,.gp3,.gp4,.gp5,.gpx,application/x-guitar-pro,application/octet-stream";

function isGpFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith(".gp3") ||
    lower.endsWith(".gp4") ||
    lower.endsWith(".gp5") ||
    lower.endsWith(".gpx") ||
    lower.endsWith(".gp")
  );
}

type Props = {
  songId: string;
};

export function GpUploadZone({ songId }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lastOk, setLastOk] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      setErr(null);
      setLastOk(false);
      if (!isGpFile(file)) {
        setErr("Use a Guitar Pro file: .gp, .gp3, .gp4, .gp5, or .gpx");
        return;
      }
      setBusy(true);
      const up = new FormData();
      up.append("file", file);
      try {
        const res = await fetch(`/api/songs/${songId}/upload`, { method: "POST", body: up });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr((body as { error?: string }).error ?? `Upload failed (${res.status})`);
          return;
        }
        setLastOk(true);
        router.refresh();
      } catch {
        setErr("Network error — try again");
      } finally {
        setBusy(false);
      }
    },
    [songId, router],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        id="gp-upload"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          "relative rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors min-h-[140px] flex flex-col items-center justify-center",
          "focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:ring-offset-2 focus:ring-offset-zinc-950",
          dragOver ? "border-emerald-500 bg-emerald-950/30" : "border-zinc-600 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-900/60",
          busy ? "pointer-events-none opacity-70" : "",
        ].join(" ")}
        aria-label="Upload Guitar Pro file: click or drop a .gp, .gp3, .gp4, .gp5, or .gpx file"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={onInputChange}
        />
        <div className="text-zinc-300 text-sm font-medium">
          {busy ? (
            "Importing and building tracks…"
          ) : (
            <>
              <span className="text-white text-base">Drop a Guitar Pro file here</span>
              <span className="block mt-2 text-zinc-500">
                or click to browse · {ACCEPT.join(" ")}
              </span>
            </>
          )}
        </div>
      </div>

      {lastOk && !busy && !err && (
        <p className="text-sm text-emerald-400" role="status">
          File imported. Tracks updated below.
        </p>
      )}

      {err && (
        <p className="text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      <p className="text-xs text-zinc-600">
        Re-uploading replaces tracks and all seven level charts for this song. Large files may take a few seconds.
      </p>
    </div>
  );
}
