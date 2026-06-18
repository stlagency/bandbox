/**
 * CommunitySignal — the quiet community-value framing in Zodiak (DESIGN.md
 * §Transparency, §Components). Park-green mark/bar, NEVER red — the eye must
 * never read "recovery" as "on fire". Two shapes:
 *  - "block" (deep-dive): a green COMMUNITY SIGNAL tag + a paragraph.
 *  - "rail"  (scan rail): a thin green bar + an inline green head + paragraph.
 */
export interface CommunitySignalProps {
  variant?: 'block' | 'rail';
  /** Rail variant: the inline head, e.g. "Community Signal". */
  head?: string;
  children: React.ReactNode;
}

export function CommunitySignal({
  variant = 'block',
  head = 'Community Signal',
  children,
}: CommunitySignalProps) {
  if (variant === 'rail') {
    return (
      <div className="pb-community pb-community--rail">
        <div className="pb-csbar" aria-hidden="true" />
        <p>
          <span className="pb-cshead">{head}</span>
          {children}
        </p>
      </div>
    );
  }
  return (
    <div className="pb-community">
      <span className="pb-cs-mark">COMMUNITY SIGNAL</span>
      <p>{children}</p>
    </div>
  );
}
