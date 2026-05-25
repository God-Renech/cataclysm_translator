export function getTargetPoLanguageCode(mode: string) {
  return mode === "s2t" ? "zh_TW" : "zh_CN";
}

function unescapePoStringContent(content: string) {
  return content
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function escapePoStringContent(content: string) {
  return content
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function extractQuotedContent(line: string) {
  const firstQuote = line.indexOf('"');
  const lastQuote = line.lastIndexOf('"');
  if (firstQuote < 0 || lastQuote <= firstQuote) return null;
  return {
    prefix: line.slice(0, firstQuote + 1),
    content: line.slice(firstQuote + 1, lastQuote),
    suffix: line.slice(lastQuote),
  };
}

function replaceQuotedContent(line: string, nextContent: string) {
  const parts = extractQuotedContent(line);
  if (!parts) return line;
  return `${parts.prefix}${nextContent}${parts.suffix}`;
}

function buildPoStringBlock(prefix: string, text: string) {
  if (!text.includes("\n")) {
    return [`${prefix}"${escapePoStringContent(text)}"`];
  }

  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue;
    chunks.push(text.slice(start, i + 1));
    start = i + 1;
  }
  if (start < text.length) {
    chunks.push(text.slice(start));
  }

  return [
    `${prefix}""`,
    ...chunks.map((chunk) => `"${escapePoStringContent(chunk)}"`),
  ];
}

function parseMsgstrPluralIndex(line: string) {
  const match = line.trim().match(/^msgstr\[(\d+)\]\s+"/);
  return match ? Number(match[1]) : null;
}

export function convertPoContent(
  content: string,
  targetLanguageCode: string,
  convertText: (text: string) => string
) {
  const lines = content.split(/\r?\n/);
  const outputLines: string[] = [];
  let currentMsgId = "";
  let currentMsgIdPlural = "";
  let activeBlock: "msgid" | "msgid_plural" | "msgstr" | "msgstr_plural" | null = null;
  let activePluralIndex: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (line.startsWith('"Language:')) {
      outputLines.push(`"Language: ${targetLanguageCode}\\n"`);
      activeBlock = null;
      activePluralIndex = null;
      continue;
    }

    if (trimmed.startsWith("msgid_plural ")) {
      const parts = extractQuotedContent(line);
      currentMsgIdPlural = unescapePoStringContent(parts?.content ?? "");
      activeBlock = "msgid_plural";
      activePluralIndex = null;
      outputLines.push(line);
      continue;
    }

    if (trimmed.startsWith("msgid ")) {
      const parts = extractQuotedContent(line);
      currentMsgId = unescapePoStringContent(parts?.content ?? "");
      currentMsgIdPlural = "";
      activeBlock = "msgid";
      activePluralIndex = null;
      outputLines.push(line);
      continue;
    }

    const pluralIndex = parseMsgstrPluralIndex(line);
    if (pluralIndex !== null) {
      const parts = extractQuotedContent(line);
      const currentTarget = unescapePoStringContent(parts?.content ?? "");
      const fallbackSource = pluralIndex === 0 ? currentMsgId : currentMsgIdPlural;
      const sourceText = currentTarget || fallbackSource;
      const nextContent = sourceText ? convertText(sourceText) : currentTarget;
      if (!currentTarget && nextContent.includes("\n")) {
        outputLines.push(...buildPoStringBlock(line.slice(0, line.indexOf('"')), nextContent));
      } else {
        outputLines.push(replaceQuotedContent(line, escapePoStringContent(nextContent)));
      }
      activeBlock = "msgstr_plural";
      activePluralIndex = pluralIndex;
      continue;
    }

    if (trimmed.startsWith("msgstr ")) {
      const parts = extractQuotedContent(line);
      const currentTarget = unescapePoStringContent(parts?.content ?? "");
      const sourceText = currentTarget || currentMsgId;
      const nextContent = sourceText ? convertText(sourceText) : currentTarget;
      if (!currentTarget && nextContent.includes("\n")) {
        outputLines.push(...buildPoStringBlock(line.slice(0, line.indexOf('"')), nextContent));
      } else {
        outputLines.push(replaceQuotedContent(line, escapePoStringContent(nextContent)));
      }
      activeBlock = "msgstr";
      activePluralIndex = null;
      continue;
    }

    if (trimmed.startsWith('"')) {
      if (activeBlock === "msgid") {
        currentMsgId += unescapePoStringContent(extractQuotedContent(line)?.content ?? "");
        outputLines.push(line);
        continue;
      }
      if (activeBlock === "msgid_plural") {
        currentMsgIdPlural += unescapePoStringContent(extractQuotedContent(line)?.content ?? "");
        outputLines.push(line);
        continue;
      }
      if (activeBlock === "msgstr") {
        const parts = extractQuotedContent(line);
        const currentTarget = unescapePoStringContent(parts?.content ?? "");
        const nextContent = currentTarget || currentMsgId ? convertText(currentTarget || currentMsgId) : currentTarget;
        outputLines.push(replaceQuotedContent(line, escapePoStringContent(nextContent)));
        continue;
      }
      if (activeBlock === "msgstr_plural") {
        const parts = extractQuotedContent(line);
        const currentTarget = unescapePoStringContent(parts?.content ?? "");
        const fallbackSource = activePluralIndex === 0 ? currentMsgId : currentMsgIdPlural;
        const nextContent = currentTarget || fallbackSource ? convertText(currentTarget || fallbackSource) : currentTarget;
        outputLines.push(replaceQuotedContent(line, escapePoStringContent(nextContent)));
        continue;
      }
    }

    activeBlock = null;
    activePluralIndex = null;
    outputLines.push(line);
  }

  return outputLines.join("\n");
}
