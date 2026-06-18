/**
 * Pill — Space Mono 10px bold, 2px ink border, square (DESIGN.md §Pills).
 *  - danger  : red fill / white  (counts against the red budget)
 *  - neutral : ink fill / bone
 *  - aged    : bone fill + brick text + brick border (sheriff/estate history)
 *  - blue    : navy fill / on-navy (permits etc.)
 */
export type PillKind = 'danger' | 'neutral' | 'aged' | 'blue';

export interface PillProps {
  kind?: PillKind;
  children: React.ReactNode;
  className?: string;
}

export function Pill({ kind = 'neutral', children, className }: PillProps) {
  return (
    <span className={`pb-pill pb-pill--${kind}${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  );
}
