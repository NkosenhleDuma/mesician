import Link from "next/link";
import { getSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-white">Mesician</h1>
        <p className="text-zinc-400 max-w-xl">
          Upload Guitar Pro files, practice on a note highway with seven difficulty levels, optional mic scoring, and
          latency calibration.
        </p>
      </div>
      {session ? (
        <Link
          href="/library"
          className="inline-block px-6 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500"
        >
          Open library
        </Link>
      ) : (
        <div className="flex gap-4">
          <Link href="/signup" className="px-6 py-3 rounded-lg bg-emerald-600 text-white font-medium">
            Get started
          </Link>
          <Link href="/login" className="px-6 py-3 rounded-lg border border-zinc-600 text-zinc-200">
            Sign in
          </Link>
        </div>
      )}
    </div>
  );
}
