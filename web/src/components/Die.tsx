const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

type Props = {
  value: number;
  index: number;
  held?: boolean;
  locked?: boolean;
  rolling?: boolean;
  onToggle?: () => void;
};

export function Die({ value, index, held = false, locked = false, rolling = false, onToggle }: Props) {
  const label = value ? `Die ${index + 1}: ${value}${held ? ", held" : ""}` : `Die ${index + 1}: not rolled`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={held}
      disabled={!onToggle || locked}
      onClick={onToggle}
      data-testid={`die-${index}`}
      data-value={value}
      data-held={held}
      className={[
        "rounded-2xl p-1 transition",
        held ? "ring-4 ring-amber-400 -translate-y-1" : "ring-1 ring-stone-600",
        onToggle && !locked ? "cursor-pointer hover:-translate-y-0.5" : "cursor-default",
        rolling ? "animate-spin" : "",
      ].join(" ")}
    >
      <svg viewBox="0 0 100 100" className="h-16 w-16 sm:h-20 sm:w-20" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="18" className="fill-stone-50 stroke-stone-800" strokeWidth="3" />
        {(PIPS[value] ?? []).map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="8.5" className="fill-stone-900" />
        ))}
        {!value && <text x="50" y="62" textAnchor="middle" fontSize="34" className="fill-stone-400">?</text>}
      </svg>
    </button>
  );
}
