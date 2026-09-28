import type { CSSProperties } from "react";
import {
  BadgeCheck,
  BookOpen,
  Calendar,
  CircleHelp,
  Flag,
  FlaskConical,
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
};

/** The icon for a Concept Kind (by its `icon` name), a light bulb when unknown. */
export function KindIcon({ name, className, style }: { name?: string; className?: string; style?: CSSProperties }) {
  const Icon = icons[name ?? ""] ?? Lightbulb;
  return <Icon className={className} style={style} aria-hidden />;
}
