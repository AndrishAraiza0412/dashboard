import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Oswald } from "next/font/google";
import "./globals.css";

// Oswald is a variable font (weights 200-700): one file covers every weight the UI uses.
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin", "latin-ext"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Ventas e inventario para tu negocio",
};

export const viewport: Viewport = { themeColor: "#faf9f5" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX" className={`${oswald.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
