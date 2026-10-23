import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LimitLeague — Strategies ranked by discipline",
  description:
    "Publish hard risk limits, test paper trade proposals with live Strike prices, and verify every decision in a public audit.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
