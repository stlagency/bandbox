/**
 * TopBand — the fixed Navy top band with the holding-mark square + Wordmark,
 * primary nav, and theme toggle (DESIGN.md §Structure, market-scan mockup).
 * Server component; the interactive bits (Wordmark equalizer, ThemeToggle) are
 * client components nested inside.
 */
import Link from 'next/link';
import { Wordmark } from './Wordmark';
import { ThemeToggle } from './ThemeToggle';
import { AccountNav } from './AccountNav';

export interface NavItem {
  label: string;
  href: string;
  current?: boolean;
}

const DEFAULT_NAV: NavItem[] = [
  // Map + leads are the two real parcel entry points. The old "Parcels" item
  // deep-linked ONE hardcoded parcel and "Learn" pointed at "/" — both dead
  // weight; re-add Learn only when a /learn route exists.
  { label: 'Market Scan', href: '/' },
  { label: 'Leads', href: '/leads' },
];

export interface TopBandProps {
  nav?: NavItem[];
  /** Which nav item is the current page. */
  current?: string;
  themeVariant?: 'band' | 'ink';
}

export function TopBand({ nav = DEFAULT_NAV, current, themeVariant = 'band' }: TopBandProps) {
  return (
    <header className="pb-topband">
      <div className="pb-brandbox">
        <div className="pb-mark-square" aria-hidden="true" />
        <Wordmark variant="band" />
      </div>
      <nav className="pb-nav" aria-label="Primary">
        {nav.map((item) => {
          const isCurrent = current ? item.label === current : item.current;
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="pb-topactions">
        <AccountNav />
        <ThemeToggle variant={themeVariant} />
      </div>
    </header>
  );
}
