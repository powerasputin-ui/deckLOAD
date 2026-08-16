import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeckLoad — Калькулятор загрузки палубы",
  description:
    "Калькулятор загрузки палубы и свободного пространства с поддержкой вращения грузов. Алгоритм Maximal Rectangles (BSSF) для 2D-упаковки.",
  keywords: [
    "загрузка палубы",
    "калькулятор",
    "упаковка",
    "bin packing",
    "вращение грузов",
    "deck loading",
  ],
  authors: [{ name: "DeckLoad" }],
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        {/* top-center used to sit directly over the header's undo/redo
            buttons — a toast from the action that made undo available was
            often still showing right when the user reached for it, silently
            eating the click. bottom-right stays clear of every header
            control and the deck canvas. */}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
