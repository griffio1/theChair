import { useId } from "react";

/** A rounded isometric bed, drawn with the shared sculpture gradients. */
export function FlowArt({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className={`flow-art ${className}`} aria-hidden="true">
      <svg viewBox="0 0 480 360" fill="none" focusable="false">
        <defs>
          <linearGradient id={`${id}-ribbon`} x1="130" y1="100" x2="350" y2="280" gradientUnits="userSpaceOnUse">
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
          <linearGradient id={`${id}-depth`} x1="120" y1="180" x2="330" y2="290" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--flow-mid, #458bff)" />
            <stop offset=".65" stopColor="var(--flow-last, #263ff0)" />
            <stop offset="1" stopColor="var(--flow-blue, var(--flow-last, #263ff0))" />
          </linearGradient>
          <linearGradient id={`${id}-linen`} x1="224" y1="115" x2="295" y2="225" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset=".45" stopColor="var(--flow-first, #92f2ff)" />
            <stop offset="1" stopColor="var(--flow-mid, #458bff)" />
          </linearGradient>
          <linearGradient id={`${id}-pillow`} x1="250" y1="120" x2="287" y2="190" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset=".65" stopColor="white" stopOpacity=".9" />
            <stop offset="1" stopColor="var(--flow-first, #92f2ff)" />
          </linearGradient>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="var(--flow-mid, #458bff)" stopOpacity=".25" />
            <stop offset="1" stopColor="var(--flow-mid, #458bff)" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-shadow`} x="-25%" y="-80%" width="150%" height="260%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>
        <ellipse cx="242" cy="246" rx="220" ry="105" fill={`url(#${id}-halo)`} />
        <g className="flow-sculpture">
          <ellipse cx="243" cy="291" rx="139" ry="29" fill="#7565bf" fillOpacity=".16" filter={`url(#${id}-shadow)`} />
          {/* A shallow lavender extrusion keeps the same floating, sculpted feel. */}
          <path d="m111 207 128-91q9-6 18-1l117 60q12 6 12 18v19q0 10-9 17l-115 83q-10 7-20 2l-131-66q-12-6-12-18v-7q0-10 12-16Z" fill="#a59be3" fillOpacity=".35" transform="translate(0 5)" />
          {/* Short, rounded feet sit behind the upholstered frame. */}
          <path d="M118 224v23m133 43v21m115-112v25" stroke={`url(#${id}-depth)`} strokeWidth="15" strokeLinecap="round" />
          {/* The headboard follows the same soft, continuous curves as the ribbon. */}
          <path d="M233 113V69q0-17 16-9l125 63q14 7 14 23v46l-155-79Z" fill={`url(#${id}-depth)`} />
          <path d="M226 111V66q0-17 16-9l125 63q14 7 14 23v45l-155-77Z" fill={`url(#${id}-ribbon)`} />
          <path d="M234 105V68q0-7 7-4l121 61q11 6 11 16v36" stroke={`url(#${id}-edge)`} strokeWidth="2" strokeLinecap="round" />
          {/* Rounded bed base, with separate front and side faces. */}
          <path d="M103 205v20q0 12 12 18l123 62q12 6 23-2l111-80q11-8 11-19v-21L103 205Z" fill={`url(#${id}-depth)`} />
          <path d="m250 278 133-95v21q0 11-11 19l-111 80q-6 4-11 5v-30Z" fill="var(--flow-last, #263ff0)" fillOpacity=".38" />
          {/* Mattress and the exposed linen at the head of the bed. */}
          <path d="m111 191 117-83q10-7 21-2l121 61q13 7 13 19v10q0 9-10 16l-112 80q-11 8-22 2l-124-62q-12-6-12-18v-7q0-10 8-16Z" fill={`url(#${id}-linen)`} />
          <path d="m111 191 117-83q10-7 21-2l121 61q16 8 2 19l-117 84q-10 7-20 2l-123-62q-13-7-1-19Z" fill={`url(#${id}-linen)`} />
          {/* The blanket rolls over the edge rather than ending in a hard slab. */}
          <path d="m192 143 144 73-75 54q-11 8-22 2l-124-62q-12-6-4-15l81-52Z" fill={`url(#${id}-ribbon)`} />
          <path d="m111 199 128 65q11 6 22-2l75-54v18l-75 54q-11 8-22 2l-124-62q-12-6-12-17v-3q0-5 8-1Z" fill={`url(#${id}-ribbon)`} />
          <path d="m190 145 143 72" stroke="var(--flow-first, #92f2ff)" strokeOpacity=".8" strokeWidth="7" strokeLinecap="round" />
          <path d="m114 199 124 63q12 6 22-2l65-47" stroke={`url(#${id}-edge)`} strokeWidth="2" strokeLinecap="round" />
          <path d="m160 186 65 33m-24-44 51 26" stroke="white" strokeOpacity=".13" strokeWidth="2" strokeLinecap="round" />
          {/* Two plump pillows make the bed readable even at card size. */}
          <path d="m214 143 19-14q6-4 13-1l35 18q8 4 1 9l-18 13q-6 4-13 1l-35-18q-8-4-2-8Zm53 27 19-14q6-4 13-1l35 18q8 4 1 9l-18 13q-6 4-13 1l-35-18q-8-4-2-8Z" fill="var(--flow-last, #263ff0)" fillOpacity=".18" />
          <path d="m212 136 20-14q6-4 13-1l35 18q8 4 1 9l-19 13q-6 4-13 1l-35-18q-8-4-2-8Z" fill={`url(#${id}-pillow)`} />
          <path d="m265 163 20-14q6-4 13-1l35 18q8 4 1 9l-19 13q-6 4-13 1l-35-18q-8-4-2-8Z" fill={`url(#${id}-pillow)`} />
          <path d="m218 134 16-11q4-2 9 0l32 16m-4 22 16-11q4-2 9 0l32 16" stroke="white" strokeOpacity=".75" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="392" cy="76" r="7" fill="var(--flow-first, #92f2ff)" />
          <circle cx="80" cy="242" r="4" fill="var(--flow-mid, #458bff)" />
          <path d="M351 291h14m-7-7v14M119 92h10m-5-5v10" stroke="var(--flow-mid, #458bff)" strokeWidth="1.5" strokeLinecap="round" />
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
