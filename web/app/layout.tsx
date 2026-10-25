import "./globals.css";
import "./pride.css";

export const metadata = {
  title: "theChair — Build in sync",
  description: "A shared space for your team, your AI agents, and the agreements that bring everything together.",
};

// Apply the saved appearance before the first paint, avoiding a light flash.
const themeScript = `(function(){try{var t=localStorage.getItem('thechair:theme');if(t!=='light'&&t!=='dark'&&t!=='pride')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
