import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smaran Health | Clinical Memory",
  description:
    "Smaran turns every consultation into structured clinical memory for follow-up care.",
};

// Prevent mobile browsers from auto-zooming (and "shrinking" the app) on input
// focus, and expand into the iPhone notch/safe-area so the layout fits the
// physical screen edge-to-edge.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f4f6f5",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
