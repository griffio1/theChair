import { useId } from "react";

/** Original vector sculpture: a continuous ribbon, with no images or render loop. */
export function FlowArt({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className={`flow-art ${className}`} aria-hidden="true">
      <svg viewBox="0 0 480 360" fill="none" focusable="false">
        <defs>
          <linearGradient id={`${id}-ribbon`} x1="90" y1="80" x2="370" y2="290" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--flow-first, #92f2ff)" />
            <stop offset=".18" stopColor="var(--flow-orange, var(--flow-mid, #458bff))" />
            <stop offset=".36" stopColor="var(--flow-yellow, var(--flow-last, #263ff0))" />
            <stop offset=".54" stopColor="var(--flow-green, var(--flow-last, #263ff0))" />
            <stop offset=".72" stopColor="var(--flow-blue, var(--flow-mid, #458bff))" />
            <stop offset=".9" stopColor="var(--flow-last, #263ff0)" />
            <stop offset="1" stopColor="var(--flow-first, #92f2ff)" />
          </linearGradient>
          <linearGradient id={`${id}-edge`} x1="130" y1="70" x2="320" y2="300" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" stopOpacity=".85" />
            <stop offset=".5" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="white" stopOpacity=".6" />
          </linearGradient>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="var(--flow-mid, #458bff)" stopOpacity=".25" />
            <stop offset="1" stopColor="var(--flow-mid, #458bff)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="242" cy="235" rx="225" ry="115" fill={`url(#${id}-halo)`} />
        <g className="flow-sculpture">
          <path d="M365 108C289 29 121 52 107 148C91 256 337 307 372 211C405 119 183 81 159 163C139 232 296 270 319 204" stroke="#071b75" strokeOpacity=".14" strokeWidth="48" strokeLinecap="round" transform="translate(0 13)" />
          <path d="M365 108C289 29 121 52 107 148C91 256 337 307 372 211C405 119 183 81 159 163C139 232 296 270 319 204" stroke={`url(#${id}-ribbon)`} strokeWidth="47" strokeLinecap="round" />
          <path d="M358 98C282 29 125 58 118 145C110 238 336 288 361 209C384 136 191 99 171 166C158 213 290 251 306 204" stroke={`url(#${id}-edge)`} strokeWidth="2" strokeLinecap="round" />
          <circle cx="382" cy="70" r="7" fill="var(--flow-first, #92f2ff)" />
          <circle cx="85" cy="247" r="4" fill="var(--flow-mid, #458bff)" />
          <path d="M338 297h14m-7-7v14M100 76h10m-5-5v10" stroke="var(--flow-mid, #458bff)" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}

export function BrandMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M6 3h12v9H6V3ZM6 12H3v5h18v-5h-3M6 17v4m12-4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
