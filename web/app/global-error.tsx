"use client";
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body>
    <main style={{ maxWidth: 520, margin: "15vh auto", padding: 24, fontFamily: "system-ui,sans-serif" }}>
      <h1>Something went wrong.</h1><p>Try loading the page again.</p>
      <button onClick={reset}>Try again</button>{" "}<a href="/">Home</a>
    </main>
  </body></html>;
}
