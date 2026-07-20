import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "AI Mastering Platform | Suno Adaptive Mastering",
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
      <body
        className={`${inter.variable} font-sans bg-background text-gray-100 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
