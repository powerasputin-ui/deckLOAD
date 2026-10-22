import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider, ThemedToaster } from "@/components/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Spec 9.3. "cyrillic" matters here: the whole UI is Russian. Without it the
// Cyrillic face isn't preloaded, so text first paints in the fallback font
// and then visibly swaps. Three weights only: 400, 500, 600.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
});

// Dimension lines on the deck and numeric table cells.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
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
        // `font-sans` is what actually applies the font: globals.css maps
        // --font-sans to --font-plex-sans, but nothing would put it on the
        // page otherwise.
        className={`${plexSans.variable} ${plexMono.variable} font-sans antialiased bg-background text-foreground`}
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
