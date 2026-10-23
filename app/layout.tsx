import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LimitLeague",
  description: "Strategies that earn rank by respecting their published limits."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
