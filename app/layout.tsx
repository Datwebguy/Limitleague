import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { RecordHost } from "./_components/RecordHost";
import { Shell } from "./_components/Shell";
import { StoreProvider } from "./_lib/store";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "LimitLeague — Follow strategies that play by their own rules",
  description:
    "Every strategy publishes its risk limits first, every trade is checked against them, and every decision is public. Practice with live Strike prices and no sign-up.",
};

export const viewport: Viewport = { themeColor: "#080b0a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body>
        <StoreProvider>
          <RecordHost>
            <Shell>{children}</Shell>
          </RecordHost>
        </StoreProvider>
      </body>
    </html>
  );
}
