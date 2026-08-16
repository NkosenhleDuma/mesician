import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function ExercisesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-white">Games &amp; Exercises</h1>
        <p className="mt-2 text-zinc-400 max-w-2xl">
          Sharpen your guitar skills with focused exercises powered by live pitch detection.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/exercises/note-selection"
          className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 hover:border-sky-700/60 hover:bg-zinc-900 transition-colors"
        >
          <h2 className="text-lg font-semibold text-white group-hover:text-sky-300">
            Note Selection
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Find notes on the fretboard under time pressure. Single-string, region, and wide modes.
          </p>
        </Link>
      </div>
    </div>
  );
}
