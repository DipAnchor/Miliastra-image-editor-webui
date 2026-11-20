/** Read only the exporter warning-comment protocol, preserving response order. */
export function extractSvgExportWarnings(text: string): string[] {
  const warnings = Array.from(
    text.matchAll(/<!--\s*Miliastra-Warning:\s*([\s\S]*?)\s*-->/g),
    match => match[1].trim()
  ).filter(Boolean);
  return [...new Set(warnings)];
}
