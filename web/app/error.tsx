"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="site-fallback"><h1>This page couldn’t load.</h1>
    <p>Try again. If it keeps happening, come back shortly.</p>
    <button onClick={reset}>Try again</button><a href="/">Home</a>
  </main>;
}
