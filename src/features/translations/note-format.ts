export function formatTranslationNote(note: string | null | undefined) {
  if (typeof note !== "string") {
    return null;
  }

  let text = note.normalize("NFKC").replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  text = text
    .replace(
      /^\s*(?:generator\s+[ab]|gemini|openai)(?:['’]s)?(?:\s+(?:interpretation|reading|take|use|choice|version|draft|explanation|note))?(?:\s+of)?\s*/i,
      ""
    )
    .replace(/^\s*(?:this\s+means|note:)\s*/i, "")
    .replace(/\b(?:generator\s+[ab]|gemini|openai)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const interpretationMatch = text.match(
    /^(?:[“"']?)(.+?)(?:[”"']?)\s+(?:as|means|is)\s+(?:[“"']?)(.+?)(?:[”"']?)(?:[.!?]\s*|$)/i
  );

  if (interpretationMatch?.[1] && interpretationMatch?.[2]) {
    const term = interpretationMatch[1].trim();
    const meaning = interpretationMatch[2].trim().replace(/[.!?]+$/, "");
    text = `“${term}” means “${meaning}”`;
  }

  text = text.replace(/^[\s\-–—:]+/, "").trim();

  if (!text) {
    return null;
  }

  if (!/[.!?]$/.test(text)) {
    text += ".";
  }

  if (text.length > 180) {
    const sentenceMatch = text.match(/^.+?[.!?](?=\s|$)/);
    if (sentenceMatch?.[0]) {
      text = sentenceMatch[0];
    } else {
      text = text.slice(0, 177).trimEnd() + "…";
    }
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function sanitizeTranslationNotes<T extends { lines: Array<{ note?: string | null }> }>(translation: T): T {
  return {
    ...translation,
    lines: translation.lines.map((line) => ({
      ...line,
      note: formatTranslationNote(line.note) ?? undefined
    }))
  };
}
