import { Anchor, Award, Castle, Clapperboard, Coffee, Compass, Droplets, Flag, Ghost, GraduationCap, Landmark, Milestone, Mountain, MountainSnow, Plane, Rocket, Route, Ship, ShoppingBag, ShoppingCart, Snowflake, Star, Telescope, TrainFront, Trees, Trophy, Utensils, Waves, Wine } from "lucide-react";

const ICONS: Record<string, typeof Award> = {
  Milestones: Trophy,
  Roads: Route,
  Parks: Trees,
  Airports: Plane,
  Bridges: Anchor,
  Coast: Waves,
  Grocery: ShoppingCart,
  Food: Utensils,
  Malls: ShoppingBag,
  Roadside: Star,
  "High points": Mountain,
  Shores: Waves,
  Battlefields: Flag,
  "Scenic drives": Route,
  Waterfalls: Droplets,
  Caves: Mountain,
  Presidents: Landmark,
  Forts: Castle,
  Wineries: Wine,
  Distilleries: Wine,
  "Drive-ins": Clapperboard,
  Diners: Coffee,
  "River crossings": Waves,
  "State lines": Milestone,
  "Natural landmarks": Mountain,
  "Hot springs": Droplets,
  Fourteeners: MountainSnow,
  "Mountain passes": MountainSnow,
  Dams: Waves,
  Lakes: Waves,
  "Museum ships": Ship,
  "Heritage railroads": TrainFront,
  "Air & space museums": Plane,
  "Space centers": Rocket,
  Observatories: Telescope,
  "Geographic oddities": Compass,
  "Ghost towns": Ghost,
  "World Heritage": Landmark,
  "Ski areas": Snowflake,
  Colleges: GraduationCap,
  Ferries: Ship,
  Tunnels: Route,
};

export function BadgeIcon({ group, earned }: { group: string; earned?: boolean }) {
  const Icon = ICONS[group] ?? Award;
  return (
    <span
      className={
        "grid size-9 shrink-0 place-items-center rounded-full " +
        (earned ? "bg-accent text-accent-ink" : "bg-elevated text-muted")
      }
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
