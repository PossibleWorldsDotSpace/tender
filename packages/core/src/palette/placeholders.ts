const SENTENCES = [
  "This is what the body content looks like inside this component.",
  "A second example, slightly longer to show how multi-line prose wraps within the available space.",
  "Component previews use real readable English so you can judge typography and rhythm.",
  "Lorem ipsum was avoided here on purpose — it makes spacing and break behavior harder to assess.",
  "Edit the palette block in project.yaml to override this with your own example text."
];

export function placeholderBody(seed = 0): string {
  return SENTENCES[seed % SENTENCES.length]!;
}

export function placeholderAttr(_name: string, allowed?: string[]): string {
  if (allowed && allowed.length > 0) return allowed[0]!;
  return "sample";
}
