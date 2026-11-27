/**
 * The top of a full screen: a back chevron with the title right beside it,
 * on the screen's own background (no band, no line). Optional small label
 * above the title, a line under it, and something on the right (a ··· menu).
 */
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

export function ScreenHeader({
  title,
  onBack,
  subtitle,
  eyebrow,
  right,
  backLabel = "Back",
  className = "",
}: {
  title: ReactNode;
  onBack: () => void;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  backLabel?: string;
  className?: string;
}) {
  return (
    <header className={"flex shrink-0 items-center gap-0.5 bg-bg pt-1 pr-2 pb-1.5 pl-1 " + className}>
      <button type="button" aria-label={backLabel} onClick={onBack} className="grid h-11 w-10 shrink-0 place-items-center rounded-full text-ink active:bg-elevated">
        <ChevronLeft className="size-6" strokeWidth={2} />
      </button>
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="truncate text-[11px] tracking-[0.14em] text-faint uppercase">{eyebrow}</p> : null}
        <p className="truncate font-serif text-xl leading-tight">{title}</p>
        {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
      </div>
      {right}
    </header>
  );
}
