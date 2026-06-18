/**
 * Ledger — the "receipts" table, set as a survey printout (DESIGN.md §Ledger
 * rows): Satoshi-700 small-caps header on Navy, zebra rows via --pb-stone, 1px
 * gravel dividers, label-left / mono value right-aligned. Value-bearing cells
 * carry a dotted "click-to-source" affordance + a trailing source stamp (wired
 * by the caller via SourceStamp / dotted spans).
 *
 * Thin structural wrappers: <Ledger>, <LedgerHead>, <LedgerBody>. Cells use the
 * .pb-num (mono, right) / .pb-lbl (UI, left) classes from components.css.
 */
import type { ReactNode } from 'react';

export interface LedgerProps {
  children: ReactNode;
  className?: string;
}

export function Ledger({ children, className }: LedgerProps) {
  return <table className={`pb-ledger${className ? ` ${className}` : ''}`}>{children}</table>;
}

export function LedgerHead({ columns }: { columns: string[] }) {
  return (
    <thead>
      <tr>
        {columns.map((c) => (
          <th scope="col" key={c}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function LedgerBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** Right-aligned mono cell. */
export function NumCell({ children }: { children: ReactNode }) {
  return <td className="pb-num">{children}</td>;
}

/** Left-aligned UI label cell. */
export function LabelCell({ children }: { children: ReactNode }) {
  return <td className="pb-lbl">{children}</td>;
}
