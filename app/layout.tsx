import type { Metadata } from "next";
import { Space_Grotesk, Sora } from "next/font/google";

import "@/app/globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const bodyFont = Sora({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "ViralCut AI | Gere cortes virais de YouTube com IA",
  description:
    "Cole um link do YouTube e gere automaticamente cortes 9:16 com score de viralização, legenda dinâmica e títulos prontos para TikTok, Reels e Shorts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${headingFont.variable} ${bodyFont.variable} bg-canvas text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
