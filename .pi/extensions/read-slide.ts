import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SLIDE_REFERENCE = /^(?<slide>[1-9]\d*)(?:\?clicks=(?<click>\d+))?$/;

function parseReference(reference: string) {
  const match = SLIDE_REFERENCE.exec(reference);
  if (!match?.groups) {
    throw new Error('Slide reference must be a one-based slide number such as "22" or "22?clicks=2".');
  }

  return {
    slide: Number(match.groups.slide),
    click: match.groups.click === undefined ? undefined : Number(match.groups.click),
  };
}

function run(command: string, args: string[], cwd: string, signal?: AbortSignal) {
  return new Promise<string>((resolvePromise, reject) => {
    // A separate process group lets cancellation stop the exporter and its
    // Playwright child process rather than leaving Chromium running.
    const child = spawn(command, args, { cwd, detached: process.platform !== "win32" });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });

    const cancel = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      }
      catch {
        // The exporter may have exited between the abort signal and this call.
      }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", error => {
      signal?.removeEventListener("abort", cancel);
      reject(error);
    });
    child.on("close", code => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) reject(new Error("Slide export cancelled."));
      else if (code === 0) resolvePromise(output);
      else reject(new Error(`Slide export failed with exit code ${code}.\n${output.trim()}`));
    });
  });
}

async function exportRenderedHtml(slide: number, click: number | undefined, output: string, cwd: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Slide HTML export cancelled.");

  // Load Slidev and Playwright only for an HTML request, rather than making
  // every Pi startup pay for the Vite/Chromium module graph.
  const { createServer, resolveOptions } = await import("@slidev/cli");
  const { chromium } = await import("playwright-chromium");
  const options = await resolveOptions({ entry: "slides.md" }, "export");
  const server = await createServer(options, { server: { port: 0 }, clearScreen: false });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const cancel = () => { void browser?.close(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Could not determine the temporary Slidev server port.");

    // This matches Slidev's CLI exporter, whose export URL base defaults to /.
    const base = "/";
    const routerMode = options.data.config.routerMode === "hash" ? "hash" : "history";
    const query = new URLSearchParams({ print: click === undefined ? "true" : "clicks", range: String(slide) });
    // The print route materializes every click state in document order. Since
    // range contains one slide, its zero-based index is the requested click.
    const url = routerMode === "hash"
      ? `http://localhost:${address.port}${base}?${query}#print`
      : `http://localhost:${address.port}${base}print?${query}`;

    browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const slides = page.locator(".print-slide-container");
    await slides.first().waitFor({ timeout: 30_000 });
    const target = slides.nth(click ?? 0);
    if (await target.count() === 0) {
      const available = await slides.evaluateAll(elements => elements.map(element => element.id));
      throw new Error(`Slide ${slide} does not have click ${click}. Available rendered states: ${available.join(", ") || "none"}.`);
    }
    await target.locator(".slidev-slide-loading").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
    if (signal?.aborted) throw new Error("Slide HTML export cancelled.");

    const slideHtml = await target.evaluate(element => element.outerHTML);
    const documentHtml = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="generator" content="Slidev rendered DOM snapshot">\n<!-- Source: slide ${slide}${click === undefined ? ", initial state" : `, click ${click}`}. -->\n</head>\n<body>\n${slideHtml}\n</body>\n</html>\n`;
    mkdirSync(resolve(cwd, ".slidev", "debug"), { recursive: true });
    writeFileSync(output, documentHtml);
  }
  finally {
    signal?.removeEventListener("abort", cancel);
    await browser?.close();
    await server.close();
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_slide",
    label: "Read Slide",
    description: "Render one Slidev slide and return its PNG for visual inspection.",
    promptSnippet: "Render a Slidev slide as an image, including an exact click state.",
    promptGuidelines: [
      "Use read_slide to inspect the rendered appearance of a Slidev slide instead of inferring it solely from Markdown or Vue source.",
    ],
    parameters: Type.Object({
      reference: Type.String({
        description: 'One-based slide reference: "22" for its initial export, or "22?clicks=2" for zero-based click state 2.',
      }),
      includeHtml: Type.Optional(Type.Boolean({
        description: "Also write the rendered slide DOM snapshot to .slidev/debug and return its path.",
      })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Slide export cancelled.");
      const { slide, click } = parseReference(params.reference);
      const exporter = resolve(ctx.cwd, "scripts/export-slide.mjs");
      if (!existsSync(exporter)) {
        throw new Error(`read_slide requires scripts/export-slide.mjs in the project root (${exporter}).`);
      }

      const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-read-slide-"));
      const output = join(temporaryDirectory, "slide.png");
      const suffix = click === undefined ? "" : `-click-${click}`;
      const htmlOutput = resolve(ctx.cwd, ".slidev", "debug", `slide-${slide}${suffix}.html`);
      try {
        onUpdate?.({ content: [{ type: "text", text: `Rendering slide ${params.reference}…` }], details: {} });
        const args = [exporter, "--slide", String(slide), "--output", output];
        if (click !== undefined) args.push("--click", String(click));
        await run(process.execPath, args, ctx.cwd, signal);

        if (params.includeHtml) {
          onUpdate?.({ content: [{ type: "text", text: `Exporting rendered HTML for slide ${params.reference}…` }], details: {} });
          await exportRenderedHtml(slide, click, htmlOutput, ctx.cwd, signal);
        }

        const htmlMessage = params.includeHtml ? ` Rendered HTML: ${htmlOutput}` : "";
        return {
          content: [
            { type: "text", text: `Rendered slide ${slide}${click === undefined ? "" : ` at click ${click}`}.${htmlMessage}` },
            { type: "image", data: readFileSync(output).toString("base64"), mimeType: "image/png" },
          ],
          details: { reference: params.reference, slide, click, htmlOutput: params.includeHtml ? htmlOutput : undefined },
        };
      }
      finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
  });
}
