// The fixed thumbnail illustration of a View Type (spec §3.2; divergence 3
// in DIVERGENCES.md): Library cards show the one for their best View's View
// Type. It is a drawing of the View Type, never a preview of an Expedition.
// Ported from the design artboard (prototypes/app-flow/project/Thumb.dc.html),
// with every colour mapped to a token so it works in both themes.
import type * as React from "react"

import { cn } from "@seply/ui/lib/utils"

/** The View Types with an illustration (`@seply/domain` VIEW_TYPE_IDS). */
export const THUMBNAIL_VIEW_TYPES = [
  "outline",
  "anatomy",
  "learning-path",
  "lineage",
  "quadrant",
  "comparison-table",
  "evidence",
  "rates",
  "cause-and-effect",
  "timeline",
  "map",
] as const

// The View Type's accent, as in the artboard; blue for the rest. Written
// out in full so Tailwind sees the classes.
type Accent = { fill: string; stroke: string }
const blue: Accent = { fill: "fill-kind-blue", stroke: "stroke-kind-blue" }
const accents: Record<string, Accent> = {
  "comparison-table": {
    fill: "fill-kind-orange",
    stroke: "stroke-kind-orange",
  },
  map: { fill: "fill-kind-green", stroke: "stroke-kind-green" },
  quadrant: { fill: "fill-kind-violet", stroke: "stroke-kind-violet" },
  evidence: { fill: "fill-kind-indigo", stroke: "stroke-kind-indigo" },
}

// Token classes, named after what they draw.
const line = "stroke-input"
const faint = "stroke-border"
const bar = "fill-input"
const barFaint = "fill-border"
const ink = "fill-muted-foreground"
const surface = "fill-card"
const well = "fill-muted"

function Drawing({ type, accent }: { type: string; accent: Accent }) {
  const { fill, stroke } = accent
  switch (type) {
    case "outline":
      return (
        <>
          <rect x="30" y="14" width="120" height="8" rx="4" className={fill} />
          <rect x="48" y="30" width="96" height="6" rx="3" className={bar} />
          <rect x="48" y="42" width="70" height="6" rx="3" className={bar} />
          <rect
            x="30"
            y="58"
            width="104"
            height="8"
            rx="4"
            className={fill}
            opacity="0.75"
          />
          <rect x="48" y="74" width="84" height="6" rx="3" className={bar} />
          <rect
            x="66"
            y="86"
            width="60"
            height="6"
            rx="3"
            className={barFaint}
          />
          <path
            d="M38 26 V46 M38 70 V90 M56 80 V92"
            className={faint}
            strokeWidth="1.5"
          />
        </>
      )
    case "anatomy":
      return (
        <>
          <rect
            x="20"
            y="10"
            width="180"
            height="90"
            rx="10"
            className={cn(line, surface)}
            strokeWidth="1.5"
          />
          <rect x="32" y="30" width="72" height="58" rx="7" className={well} />
          <rect x="114" y="30" width="74" height="26" rx="7" className={well} />
          <rect x="114" y="62" width="74" height="26" rx="7" className={well} />
          <rect x="40" y="40" width="26" height="8" rx="4" className={fill} />
          <rect
            x="70"
            y="40"
            width="22"
            height="8"
            rx="4"
            className="fill-kind-amber"
          />
          <rect
            x="40"
            y="54"
            width="30"
            height="8"
            rx="4"
            className="fill-kind-green"
          />
          <rect x="122" y="38" width="28" height="8" rx="4" className={fill} />
          <rect
            x="122"
            y="70"
            width="22"
            height="8"
            rx="4"
            className="fill-kind-green"
          />
          <rect
            x="148"
            y="70"
            width="26"
            height="8"
            rx="4"
            className="fill-kind-amber"
          />
          <rect x="32" y="16" width="50" height="6" rx="3" className={ink} />
        </>
      )
    case "learning-path":
      return (
        <>
          <path
            d="M26 30 L66 30 L106 55 M26 80 L66 80 L106 55 L146 40 L186 55 M106 55 L146 75 L186 55 M66 30 L106 20"
            className={stroke}
            strokeWidth="1.6"
          />
          <path
            d="M106 20 L146 12"
            className={faint}
            strokeWidth="1.4"
            strokeDasharray="3 3"
          />
          {[
            [26, 30],
            [26, 80],
            [66, 30],
            [66, 80],
            [106, 55],
            [146, 40],
            [146, 75],
          ].map(([cx, cy]) => (
            <circle
              key={`${cx},${cy}`}
              cx={cx}
              cy={cy}
              r="6"
              className={fill}
            />
          ))}
          <circle cx="106" cy="20" r="4" className={barFaint} />
          <circle cx="146" cy="12" r="4" className={barFaint} />
          <circle
            cx="186"
            cy="55"
            r="10"
            className="fill-suggested/20 stroke-suggested"
            strokeWidth="2"
          />
        </>
      )
    case "lineage":
      return (
        <>
          <rect
            x="10"
            y="10"
            width="200"
            height="40"
            rx="6"
            className="fill-kind-teal/10"
          />
          <rect
            x="10"
            y="60"
            width="200"
            height="40"
            rx="6"
            className="fill-kind-green/10"
          />
          <path
            d="M30 30 C60 30 60 22 90 22 M90 22 C120 22 120 34 150 34 M150 34 L190 26 M90 22 C120 22 120 80 150 80 M40 80 L110 80 L150 80 L190 72"
            className="stroke-kind-teal"
            strokeWidth="1.6"
          />
          {[
            [30, 30],
            [90, 22],
            [150, 34],
            [190, 26],
          ].map(([cx, cy]) => (
            <circle
              key={`${cx},${cy}`}
              cx={cx}
              cy={cy}
              r="5"
              className={fill}
            />
          ))}
          {[
            [40, 80],
            [110, 80],
            [150, 80],
            [190, 72],
          ].map(([cx, cy]) => (
            <circle
              key={`${cx},${cy}`}
              cx={cx}
              cy={cy}
              r="5"
              className="fill-kind-teal"
            />
          ))}
        </>
      )
    case "quadrant":
      return (
        <>
          <path
            d="M110 8 V102 M30 55 H190"
            className={line}
            strokeWidth="1.5"
          />
          <rect
            x="136"
            y="16"
            width="44"
            height="30"
            rx="6"
            className={fill}
            opacity="0.12"
          />
          <circle cx="150" cy="26" r="6" className={fill} />
          <circle cx="168" cy="36" r="5" className={fill} />
          <circle cx="140" cy="40" r="4" className={fill} opacity="0.7" />
          <circle cx="70" cy="30" r="5" className={ink} />
          <circle cx="84" cy="76" r="5" className={ink} />
          <circle cx="56" cy="86" r="4" className={ink} opacity="0.6" />
          <circle cx="150" cy="82" r="5" className="fill-kind-amber" />
        </>
      )
    case "comparison-table": {
      const dots: [number, number, string][] = [
        [100, 37, "fill-kind-green"],
        [136, 37, "fill-kind-red"],
        [172, 37, "fill-kind-green"],
        [100, 55, "fill-kind-green"],
        [136, 55, "fill-kind-green"],
        [172, 55, "fill-kind-green"],
        [100, 73, "fill-kind-red"],
        [136, 73, "fill-kind-green"],
        [172, 73, bar],
        [100, 91, "fill-kind-green"],
        [136, 91, bar],
        [172, 91, "fill-kind-red"],
      ]
      return (
        <>
          <rect
            x="20"
            y="10"
            width="180"
            height="90"
            rx="8"
            className={cn(surface, faint)}
          />
          <rect x="20" y="10" width="180" height="18" rx="8" className={well} />
          <rect
            x="21"
            y="46"
            width="178"
            height="18"
            className={fill}
            opacity="0.14"
          />
          <path
            d="M20 28 H200 M20 46 H200 M20 64 H200 M20 82 H200 M76 10 V100"
            className={faint}
          />
          <rect x="28" y="33" width="36" height="7" rx="3.5" className={ink} />
          <rect x="28" y="51" width="40" height="7" rx="3.5" className={fill} />
          <rect
            x="28"
            y="69"
            width="30"
            height="7"
            rx="3.5"
            className={ink}
            opacity="0.6"
          />
          <rect
            x="28"
            y="87"
            width="34"
            height="7"
            rx="3.5"
            className={ink}
            opacity="0.6"
          />
          {dots.map(([cx, cy, c]) => (
            <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="4" className={c} />
          ))}
        </>
      )
    }
    case "evidence":
      return (
        <>
          <path
            d="M46 22 L96 55 M46 55 L96 55 M46 88 L96 55 M124 55 L174 30 M124 55 L174 80"
            className={line}
            strokeWidth="1.5"
          />
          <rect x="26" y="15" width="30" height="14" rx="4" className={fill} />
          <rect x="26" y="48" width="30" height="14" rx="4" className={fill} />
          <rect
            x="26"
            y="81"
            width="30"
            height="14"
            rx="4"
            className={fill}
            opacity="0.6"
          />
          <rect
            x="92"
            y="42"
            width="36"
            height="26"
            rx="6"
            className="fill-suggested/20 stroke-suggested"
            strokeWidth="1.6"
          />
          <rect
            x="164"
            y="23"
            width="30"
            height="14"
            rx="4"
            className="fill-kind-amber"
          />
          <rect
            x="164"
            y="73"
            width="30"
            height="14"
            rx="4"
            className="fill-kind-amber"
            opacity="0.6"
          />
        </>
      )
    case "rates":
      return (
        <>
          <path
            d="M20 98 H200 M60 94 V100 M110 94 V100 M160 94 V100"
            className={line}
            strokeWidth="1.5"
          />
          <path d="M110 8 V92" className={faint} strokeDasharray="3 3" />
          <rect
            x="120"
            y="14"
            width="60"
            height="8"
            rx="4"
            className="fill-kind-red"
          />
          <rect
            x="132"
            y="28"
            width="30"
            height="8"
            rx="4"
            className="fill-kind-red"
            opacity="0.7"
          />
          <rect x="36" y="48" width="56" height="8" rx="4" className={fill} />
          <rect
            x="50"
            y="62"
            width="44"
            height="8"
            rx="4"
            className={fill}
            opacity="0.7"
          />
          <rect
            x="24"
            y="76"
            width="40"
            height="8"
            rx="4"
            className={fill}
            opacity="0.5"
          />
        </>
      )
    case "cause-and-effect":
      return (
        <>
          <path
            d="M50 22 L100 45 M50 55 L100 45 M50 88 L100 70 M112 50 L160 58 M112 70 L160 58"
            className="stroke-kind-red"
            strokeWidth="1.6"
          />
          <path
            d="M50 55 L100 70"
            className="stroke-kind-green"
            strokeWidth="1.6"
          />
          <rect
            x="22"
            y="14"
            width="30"
            height="16"
            rx="4"
            className={cn(surface, line)}
          />
          <rect
            x="22"
            y="47"
            width="30"
            height="16"
            rx="4"
            className={cn(surface, stroke)}
            strokeWidth="2"
          />
          <rect
            x="22"
            y="80"
            width="30"
            height="16"
            rx="4"
            className={cn(surface, line)}
          />
          <rect
            x="98"
            y="38"
            width="28"
            height="16"
            rx="4"
            className={cn(surface, line)}
          />
          <rect
            x="98"
            y="63"
            width="28"
            height="16"
            rx="4"
            className={cn(surface, line)}
          />
          <rect
            x="158"
            y="46"
            width="42"
            height="24"
            rx="6"
            className="fill-kind-red/15 stroke-kind-red"
            strokeWidth="1.6"
          />
        </>
      )
    case "timeline":
      return (
        <>
          <path d="M14 36 H206 M14 66 H206 M14 96 H206" className={faint} />
          <path d="M40 8 V100 M100 8 V100 M160 8 V100" className={faint} />
          <rect x="24" y="16" width="70" height="12" rx="6" className={fill} />
          <rect
            x="110"
            y="16"
            width="86"
            height="12"
            rx="6"
            className={fill}
            opacity="0.4"
          />
          <rect
            x="60"
            y="46"
            width="90"
            height="12"
            rx="6"
            className="fill-kind-teal"
          />
          <path
            d="M44 80 l6 -6 l6 6 l-6 6 z M124 80 l6 -6 l6 6 l-6 6 z M176 80 l6 -6 l6 6 l-6 6 z"
            className="fill-kind-slate"
          />
        </>
      )
    case "map":
      return (
        <>
          <rect
            x="0"
            y="0"
            width="220"
            height="110"
            className="fill-kind-blue/10"
          />
          <path
            d="M30 100 C24 70 50 58 64 40 C80 20 120 14 150 22 C180 30 200 52 196 80 C194 96 180 106 170 110 L36 110 Z"
            className={cn(well, faint)}
          />
          <path
            d="M110 54 L150 38 M110 54 L88 80"
            className="stroke-kind-violet"
            strokeWidth="1.4"
            strokeDasharray="4 3"
          />
          <circle cx="70" cy="62" r="5" className={ink} />
          <circle cx="130" cy="78" r="5" className={ink} />
          <circle cx="170" cy="60" r="5" className={ink} />
          <circle cx="150" cy="38" r="5" className="fill-kind-violet" />
          <circle cx="88" cy="80" r="5" className="fill-kind-violet" />
          <circle
            cx="110"
            cy="54"
            r="9"
            className={cn(fill, "stroke-card")}
            strokeWidth="2.5"
          />
        </>
      )
    default:
      // No Views yet (or an unknown type): an empty frame.
      return (
        <rect
          x="20"
          y="10"
          width="180"
          height="90"
          rx="10"
          className={faint}
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      )
  }
}

/**
 * The fixed illustration of a View Type, 2:1. `viewType` null (no Views
 * yet) draws an empty dashed frame.
 */
export function ViewTypeThumbnail({
  viewType,
  className,
  ...props
}: { viewType: string | null } & Omit<React.ComponentProps<"svg">, "viewBox">) {
  const type = viewType ?? ""
  return (
    <svg
      data-slot="view-type-thumbnail"
      data-view-type={type || "none"}
      viewBox="0 0 220 110"
      fill="none"
      aria-hidden="true"
      className={cn("h-auto w-full", className)}
      {...props}
    >
      <Drawing type={type} accent={accents[type] ?? blue} />
    </svg>
  )
}
