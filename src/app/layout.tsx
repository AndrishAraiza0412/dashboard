import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["400"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Ventas e inventario para tu negocio",
};

export const viewport: Viewport = { themeColor: "#faf9f5" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX" className={`${inter.variable} ${sourceSerif.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
