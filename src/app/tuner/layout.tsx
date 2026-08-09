import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tuner — Mesician",
  description: "Guitar tuner with support for standard and alternate tunings",
};

export default function TunerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
