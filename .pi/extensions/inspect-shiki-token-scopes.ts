import { Type } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHighlighter } from "shiki";

function scopeToCssVar(scope: string, prefix: string): string | undefined {
  const key = scope
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return key ? `${prefix}token-${key}` : undefined;
}

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "inspect_shiki_token_scopes",
    label: "Inspect Shiki Token Scopes",
    description:
      "Lists a source file's Shiki tokens, TextMate scopes, and derived CSS variables. Output is limited to 2,000 lines or 50 KB.",
    promptSnippet: "Inspect a source file's Shiki tokens, TextMate scopes, and derived CSS variables",
    promptGuidelines: [
      "Use inspect_shiki_token_scopes to diagnose syntax-highlighting scopes or Shiki CSS variable names.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Source file path, relative to the project or absolute" }),
      theme: Type.Optional(Type.String({ description: "Shiki theme name (default: nord)" })),
      lang: Type.Optional(Type.String({ description: "Shiki language ID (default: kotlin)" })),
      cssPrefix: Type.Optional(
        Type.String({ description: "Prefix for derived CSS variables (default: --shiki-)" }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const inputPath = normalizePath(params.path);
      const absolutePath = resolve(ctx.cwd, inputPath);
      const theme = params.theme ?? "nord";
      const lang = params.lang ?? "kotlin";
      const cssPrefix = params.cssPrefix ?? "--shiki-";
      const code = await readFile(absolutePath, "utf8");
      const highlighter = await createHighlighter({ themes: [theme], langs: [lang] });

      try {
        const grammar = highlighter.getLanguage(lang);
        const scopes = new Set<string>();
        const cssVars = new Set<string>();
        const output = [
          `File: ${inputPath}`,
          `Theme: ${theme}`,
          `Language: ${lang}`,
          `CSS variable prefix: ${cssPrefix}`,
          "",
        ];

        for (const [lineIndex, line] of code.split("\n").entries()) {
          signal?.throwIfAborted();
          output.push(`Line ${lineIndex + 1}: ${line}`);
          const tokens = grammar.tokenizeLine(line).tokens;

          for (const [tokenIndex, token] of tokens.entries()) {
            const endIndex = tokens[tokenIndex + 1]?.startIndex ?? line.length;
            const content = line.slice(token.startIndex, endIndex);
            const tokenScopes = token.scopes ?? [];
            const tokenCssVars = tokenScopes
              .map((scope) => scopeToCssVar(scope, cssPrefix))
              .filter((value): value is string => value !== undefined);
            tokenScopes.forEach((scope) => scopes.add(scope));
            tokenCssVars.forEach((cssVar) => cssVars.add(cssVar));
            output.push(
              `  Token ${tokenIndex + 1}: ${JSON.stringify(content)}`,
              `    Scopes: ${tokenScopes.length > 0 ? tokenScopes.join(" | ") : "(none)"}`,
              `    CSS vars: ${tokenCssVars.length > 0 ? tokenCssVars.join(", ") : "(none)"}`,
            );
          }
          output.push("");
        }

        output.push("Unique scopes encountered:", ...[...scopes].sort().map((scope) => `  ${scope}`));
        output.push(
          "",
          "Unique CSS variable names (derived from scopes):",
          ...[...cssVars].sort().map((cssVar) => `  ${cssVar}`),
        );

        const fullOutput = output.join("\n");
        const truncated = truncateHead(fullOutput, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });
        const text = truncated.truncated
          ? `${truncated.content}\n\n[Output truncated; showing the first ${truncated.outputLines} of ${truncated.totalLines} lines.]`
          : truncated.content;

        return {
          content: [{ type: "text", text }],
          details: {
            path: absolutePath,
            theme,
            lang,
            cssPrefix,
            scopes: [...scopes].sort(),
            cssVars: [...cssVars].sort(),
            truncated: truncated.truncated,
          },
        };
      } finally {
        highlighter.dispose();
      }
    },
  });
}
