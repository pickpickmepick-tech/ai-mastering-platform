import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adaptive Mastering & Anti-AI Bypass Platform",
  description:
    "Suno AI 음원 전용 하이브리드 어댑티브 마스터링 및 Anti-AI 우회 플랫폼",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body className="text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
