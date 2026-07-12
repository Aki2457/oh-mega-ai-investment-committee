import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.OH_MEGA_BASE_URL ?? "https://ohmega-committee-sg-20260711.zeabur.app"),
  title: "OH MEGA Capital | Investment Command Center",
  description: "AI-supported paper investment committee for US and China technology markets.",
  openGraph: {
    title: "OH MEGA Capital | AI Investment Command Center",
    description: "Research, Risk, CIO decisions, and simulated portfolio oversight in one command center.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "OH MEGA Capital AI Investment Command Center" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "OH MEGA Capital | AI Investment Command Center",
    description: "Research, Risk, CIO decisions, and simulated portfolio oversight.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
