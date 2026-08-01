import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aurora CMS",
  description: "Headless CMS admin",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
