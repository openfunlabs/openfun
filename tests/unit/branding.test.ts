import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  headerLines,
  installOpenfunHeader,
  openfunVersion,
} from "../../src/agent/branding.js";
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

test("player header uses product version and wraps world text in narrow terminals", () => {
  const lines = headerLines(theme, "深林世界\u001b[31m", "/games/forest", 80);
  const text = lines.join("\n");
  assert.match(
    text,
    new RegExp(`OpenFun.*v${openfunVersion().replaceAll(".", "\\.")}`),
  );
  assert.match(text, /Type \/ for commands\./);
  assert.doesNotMatch(text, /\/play|\/world|\/new|\/model|\/login|\/about/);
  assert.match(text, /深林世界/);
  assert.doesNotMatch(
    headerLines(theme, "Forest", "/games/forest", 80).join("\n"),
    /[\p{Script=Han}]/u,
  );
  assert.doesNotMatch(text, /\u001b|pi-mcp-adapter|coding-agent/);
  const narrow = headerLines(
    theme,
    "一个很长的中文游戏世界名称",
    "/some/long/game/path",
    24,
  );
  assert.ok(narrow.length > lines.length);
  assert.ok(narrow.every((line) => [...line].length <= 24));
});

test("OpenFun header updates the real TUI hooks without changing headless sessions", () => {
  let title = "",
    renders = 0;
  const ctx = {
    mode: "tui",
    ui: {
      setHeader(
        factory: NonNullable<
          Parameters<ExtensionContext["ui"]["setHeader"]>[0]
        >,
      ) {
        const component = factory({} as never, theme);
        assert.match(component.render(80).join("\n"), /Second world/);
        renders++;
      },
      setTitle(value: string) {
        title = value;
      },
    },
  } as unknown as ExtensionContext;
  installOpenfunHeader(ctx, "Second world", "/games/second");
  assert.equal(title, "OpenFun · Second world");
  assert.equal(renders, 1);
  installOpenfunHeader(
    { ...ctx, mode: "print" } as ExtensionContext,
    "Hidden",
    "/tmp",
  );
  assert.equal(renders, 1);
});
