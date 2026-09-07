/**
 * TK3D mark: a tapering stack of layers evoking an FDM print building up,
 * paired with the wordmark. `iconOnly` renders just the badge (used for
 * tight spaces); otherwise the full lockup with "TK3D" next to it.
 */
export function Logo({ iconOnly = false, size = 32 }: { iconOnly?: boolean; size?: number }) {
  const icon = (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-amber-600 dark:fill-amber-500" />
      <rect x="8" y="20" width="16" height="3" rx="1.2" fill="white" />
      <rect x="10" y="15" width="12" height="3" rx="1.2" fill="white" opacity="0.85" />
      <rect x="12" y="10" width="8" height="3" rx="1.2" fill="white" opacity="0.7" />
      <rect x="14" y="5" width="4" height="3" rx="1.2" fill="white" opacity="0.55" />
    </svg>
  )

  if (iconOnly) return icon

  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
        TK<span className="text-amber-600 dark:text-amber-500">3D</span>
      </span>
    </span>
  )
}
