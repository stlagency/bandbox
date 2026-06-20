/**
 * Pill — Space Mono 10px bold, 1px gravel hairline border, square (DESIGN.md §Pills).
 *  - danger  : bone fill + brick text + brick border (downshifted distress signal)
 *  - urgent  : red fill / white  (genuine crisis — counts against the red budget)
 *  - neutral : ink fill / bone
 *  - aged    : bone fill + brick text + brick border (sheriff/estate history)
 *  - blue    : navy fill / on-navy (permits etc.)
 */
export type PillKind = 'danger' | 'urgent' | 'neutral' | 'aged' | 'blue';

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
