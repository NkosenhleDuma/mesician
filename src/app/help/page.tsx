import Link from "next/link";

export default function HelpPage() {
  return (
    <article className="prose prose-invert max-w-none space-y-6 text-zinc-300">
      <h1 className="text-2xl font-semibold text-white">Help</h1>
      <section>
        <h2 className="text-lg text-white">Uploads</h2>
        <p>
          Use <code className="text-emerald-400">.gp</code> (Guitar Pro 7/8),{" "}
          <code className="text-emerald-400">.gp3</code>, <code className="text-emerald-400">.gp4</code>,{" "}
          <code className="text-emerald-400">.gp5</code>, or <code className="text-emerald-400">.gpx</code> Guitar Pro
          files. After upload, tracks are extracted and each one is assigned a difficulty tier automatically.
        </p>
      </section>
      <section>
        <h2 className="text-lg text-white">Difficulty</h2>
        <p>
          Difficulty uses the uploaded tab as-is. The tier is based on fret range, event density, rhythmic granularity,
          chord size, and techniques like hammer-ons, slides, vibrato, bends, and mutes.
        </p>
      </section>
      <section>
        <h2 className="text-lg text-white">Latency</h2>
        <p>
          Adjust <strong>Input latency (ms)</strong> in the practice panel so onsets line up with the chart. The value
          is stored in this browser.
        </p>
      </section>
      <section>
        <h2 className="text-lg text-white">Tab editor</h2>
        <p>
          From a song’s track list, open <strong>Edit tab</strong> to change the JSON chart; saving updates the stored tab
          and recomputes difficulty for that track and song.
        </p>
      </section>
      <p>
        <Link href="/library" className="text-sky-400">
          Back to library
        </Link>
      </p>
    </article>
  );
}
