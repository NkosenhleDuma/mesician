import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Note Selection",
};

export default function NoteSelectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
