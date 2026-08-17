import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smaran Health | Clinical Memory",
  description:
    "Smaran turns every consultation into structured clinical memory for follow-up care.",
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
