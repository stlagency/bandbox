/**
 * Card — Bone surface, tier-1 1px gravel hairline by default, or 4px ink + offset
 * shadow when "frame"/"mass" (DESIGN.md §Components, restraint pass). Optional header
 * in Satoshi-700 sentence-case over a 3px divider, with an optional mono "tally".
 */
import type { HTMLAttributes } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Card header label (left). */
  title?: React.ReactNode;
  /** Mono tally shown right of the title, e.g. "N = 4 · 12 MO". */
  tally?: React.ReactNode;
  /** id for the header, to wire aria-labelledby. */
  headingId?: string;
  /** Promote to a 4px primary-region frame. */
  frame?: boolean;
  /** Use the 10px page-defining mass shadow. */
  mass?: boolean;
  /** Render as <section> (default <section>); allows aria-labelledby. */
  as?: 'section' | 'div';
}

export function Card({
  title,
  tally,
  headingId,
  frame = false,
  mass = false,
  as = 'section',
  className,
  children,
  ...rest
}: CardProps) {
  const cls = [
    'pb-cardbox',
    frame ? 'pb-cardbox--frame' : '',
    mass ? 'pb-cardbox--mass' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const Tag = as;
  return (
    <Tag className={cls} {...rest}>
      {title ? (
        <h2 className="pb-card-head" id={headingId}>
          <span>{title}</span>
          {tally ? <span className="pb-tally">{tally}</span> : null}
        </h2>
      ) : null}
      {children}
    </Tag>
  );
}
