"use client";

import { useParams } from "next/navigation";
import { ChartEditor } from "@/components/chart-editor/ChartEditor";

export default function EditTabPage() {
  const { songId, trackId } = useParams<{ songId: string; trackId: string }>();
  return <ChartEditor songId={songId} trackId={trackId} />;
}
