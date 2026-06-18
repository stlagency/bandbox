'use client';

/**
 * GlossaryTerm — a dotted-underlined inline term that opens a one-sentence
 * Zodiak definition in the context rail (DESIGN.md §Context rail / glossary).
 * Mirrors the mockup `.pb-term` + teach().
 *
 * Pass a known glossary `term` key (clr/armslength/distress) OR an explicit
 * `definition` for ad-hoc terms.
 */
import { useRail, GLOSSARY, type RailDefinition } from './ContextRail';

export interface GlossaryTermProps {
  /** Known key in GLOSSARY. */
  term?: keyof typeof GLOSSARY;
  /** Explicit definition (overrides term lookup). */
  definition?: RailDefinition;
  children: React.ReactNode;
}

export function GlossaryTerm({ term, definition, children }: GlossaryTermProps) {
  const rail = useRail();
  const def = definition ?? (term ? GLOSSARY[term] : undefined);

  function open() {
    if (def) rail.teach(def);
  }

  return (
    <button
      type="button"
      className="pb-term"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      {children}
    </button>
  );
}
