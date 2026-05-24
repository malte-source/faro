import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Faro — Navigate your projects with clarity",
  description: "The project management platform built for Google Workspace teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={`${geist.className} h-full`}>
      <body className="min-h-full bg-slate-50 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
