import type { Metadata } from "next";
import "./globals.css";
import "./smaran.css";

export const metadata: Metadata = {
  title: "Smaran AI | Clinical Memory for Indian Doctors",
  description:
    "Smaran AI turns every consultation into structured clinical memory for follow-up care.",
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
      <body>{children}</body>
    </html>
  );
}
