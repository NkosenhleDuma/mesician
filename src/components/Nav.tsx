import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";

export async function Nav() {
  const session = await getSession();
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="font-semibold text-lg text-white tracking-tight">
          Mesician
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {session ? (
            <>
              <Link href="/library" className="text-zinc-300 hover:text-white">
                Library
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="text-zinc-300 hover:text-white">
                Sign in
              </Link>
              <Link href="/signup" className="text-sky-400 hover:text-sky-300">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
