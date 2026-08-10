import type { ReactNode } from "react";
import type { SearchResultHighlight } from "../lib/localSearch";

type HighlightedTextProps = {
  text: string;
  ranges?: ReadonlyArray<SearchResultHighlight>;
};

export function HighlightedText({ text, ranges = [] }: HighlightedTextProps) {
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const output: ReactNode[] = [];
  let offset = 0;
  ranges.forEach(({ start, end }, index) => {
    if (start < offset || end <= start) {
      return;
    }
    if (start > offset) {
      output.push(text.slice(offset, start));
    }
    output.push(<mark key={`${start}:${end}:${index}`}>{text.slice(start, end)}</mark>);
    offset = end;
  });
  if (offset < text.length) {
    output.push(text.slice(offset));
  }

  return (
    <>
      {output}
    </>
  );
}
