import type { Metadata } from "next";
import { Geist, Bebas_Neue } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas-neue",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DAVE - AI Powered Project Management",
  description: "Manage projects, epics, and issues with AI orchestration and capacity tracking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: some browser extensions inject attributes onto
    // <html>/<body> (e.g. cz-shortcut-listen) before React hydrates. The
    // server HTML never contains them, so React reports a mismatch that it
    // cannot patch. This is an extension artifact, not an app defect, so we
    // silence it at the root instead of chasing it in every page.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
