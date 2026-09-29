import type { CSSProperties } from "react";
import {
  BadgeCheck,
  BookOpen,
  Calendar,
  CircleHelp,
  Flag,
  FlaskConical,
  Folder,
  Gauge,
  Lightbulb,
  ListChecks,
  MapPin,
  MessageSquareQuote,
  Package,
  Scale,
  ShieldAlert,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  idea: Lightbulb,
  person: User,
  place: MapPin,
  thing: Package,
  option: Package,
  claim: MessageSquareQuote,
  source: BookOpen,
  evidence: FlaskConical,
  question: CircleHelp,
  decision: Scale,
  criterion: ListChecks,
  action: Wrench,
  event: Calendar,
  measurement: Gauge,
  risk: ShieldAlert,
  goal: Flag,
  outcome: BadgeCheck,
  topic: Folder,
  // The built-in Kinds' `icon` names (@umbel/domain BUILTIN_KINDS), drawn
  // with the same icons as above.
  lightbulb: Lightbulb,
  folder: Folder,
  "circle-help": CircleHelp,
  target: Flag,
  user: User,
  "map-pin": MapPin,
  box: Package,
  "message-square-quote": MessageSquareQuote,
  "file-check": FlaskConical,
  "list-checks": ListChecks,
  "git-branch": Scale,
  play: Wrench,
  calendar: Calendar,
  "book-open": BookOpen,
  ruler: Gauge,
  "triangle-alert": ShieldAlert,
};

/** The icon for a Concept Kind (by its `icon` name, or a Kind id), a light bulb when unknown. */
export function KindIcon({ name, className, style }: { name?: string; className?: string; style?: CSSProperties }) {
  const key = name?.startsWith("builtin:") ? name.slice("builtin:".length) : (name ?? "");
  const Icon = icons[key] ?? Lightbulb;
  return <Icon className={className} style={style} aria-hidden />;
}
