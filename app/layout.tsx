import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Running route finder — Matthias Bachfischer",
  description:
    "Find a running loop from any starting point. Choose your distance and direction, explore mapped paths, and download a GPX route.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
