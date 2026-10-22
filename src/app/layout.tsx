import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider, ThemedToaster } from "@/components/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// "cyrillic" matters here: the whole UI is Russian. Without it the Cyrillic
// face isn't preloaded, so text first paints in the fallback font and then
// visibly swaps to Geist.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
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
      <head>
        {/* Sets the theme class before the first paint (see THEME_INIT_SCRIPT). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        // `font-sans` is what actually applies Geist: globals.css maps
        // --font-sans to --font-geist-sans, but nothing used to put it on the
        // page, so the whole app rendered in the OS default font instead.
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        {/* top-center used to sit directly over the header's undo/redo
            buttons — a toast from the action that made undo available was
            often still showing right when the user reached for it, silently
            eating the click. bottom-right stays clear of every header
            control and the deck canvas.
            Rendered BEFORE the page on purpose: the Toaster only shows toasts
            published after its own mount effect subscribes, and effects run
            in tree order — after the page, it silently dropped every toast
            fired while the page mounts (e.g. hydrate()'s "couldn't save"
            warning on a first visit with storage unavailable, which was
            therefore never seen — and then muted every later one too, see
            hasWarnedAboutStorageFailure in projects.ts). */}
        <ThemeProvider>
          <ThemedToaster />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
