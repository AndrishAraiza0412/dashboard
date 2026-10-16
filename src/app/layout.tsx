import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Oswald } from "next/font/google";
import { APP_NAME } from "@/lib/brand";
import "./globals.css";

// Oswald is a variable font (weights 200-700): one file covers every weight the UI uses.
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin", "latin-ext"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Ventas e inventario para tu negocio",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1917" },
  ],
};

// Mirrors apply() in components/shell/theme-picker.tsx.
const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("theme")||"system",p=localStorage.getItem("palette")||"coral",s=localStorage.getItem("style")||"solid";d.dataset.themePref=t;d.dataset.theme=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";d.dataset.palette=p;d.dataset.style=s}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script sets data-theme/data-palette/data-style before first paint, so the attributes differ from the server HTML.
    <html lang="es-MX" className={`${oswald.variable} ${jetbrains.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
