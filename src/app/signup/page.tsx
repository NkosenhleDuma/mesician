"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Signup failed");
      return;
    }
    router.push("/library");
    router.refresh();
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-white">Create account</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-zinc-400">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-white"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-zinc-400">Password (min 8 characters)</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-white"
          />
        </label>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" className="w-full py-3 rounded-lg bg-emerald-600 text-white font-medium">
          Sign up
        </button>
      </form>
      <p className="text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="text-sky-400">
          Sign in
        </Link>
      </p>
    </div>
  );
}
