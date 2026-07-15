import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.OH_MEGA_BASE_URL ?? "https://oh-mega-capital-command-center.onionsoop.chatgpt.site"),
  title: "Virtual Fund | Investment Command Center",
  description: "A safety-first virtual fund with AI research, a four-role committee, and Human approval.",
  openGraph: {
    title: "Virtual Fund | AI Investment Command Center",
    description: "Decision, Risk, CEO, and Human oversight for a simulated portfolio with a permanent cash reserve.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Virtual Fund | AI Investment Command Center",
    description: "A virtual fund with web research, AI forecasts, and Human approval.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
