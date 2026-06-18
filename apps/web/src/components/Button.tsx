/**
 * Button — square, 3px ink border, offset hard shadow (DESIGN.md §Buttons).
 * Primary = red fill + white Space Mono + "→" (the CTA spends the red budget;
 * use AT MOST one primary per screen). Secondary = ink fill + "+". Ghost =
 * transparent + ink border. Pressed = translate(2px,2px) + shadow shrinks.
 */
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Drop the offset shadow (used for the inline ghost on the filter rail). */
  noShadow?: boolean;
}

export function Button({
  variant = 'secondary',
  noShadow = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'pb-btn',
    `pb-btn--${variant}`,
    noShadow ? 'pb-btn--noshadow' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
