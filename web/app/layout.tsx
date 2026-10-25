import "./globals.css";
import "./pride.css";
import { headers } from "next/headers";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "theChair",
  description: "Team chat and shared code agreements.",
  applicationName: "theChair",
  openGraph: { title: "theChair", description: "Team chat and shared code agreements.", type: "website" },
  twitter: { card: "summary", title: "theChair", description: "Team chat and shared code agreements." },
};

// Apply the saved appearance before the first paint, avoiding a light flash.
const themeScript = `(function(){try{var t=localStorage.getItem('thechair:theme');if(t!=='light'&&t!=='dark'&&t!=='pride')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
