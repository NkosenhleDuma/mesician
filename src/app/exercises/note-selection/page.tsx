import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoteGameShellLoader } from "@/components/exercises/note-selection/NoteGameShellLoader";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Note Selection | Mesician",
  description: "Timed fretboard note identification exercise",
};

export default async function NoteSelectionPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="max-w-3xl mx-auto">
      <NoteGameShellLoader />
    </div>
  );
}
