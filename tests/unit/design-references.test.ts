import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractReferenceText,
  searchDesignReferences,
  readDesignReference,
} from "../../src/agent/design-references.js";

test("reference search distinguishes curated guidance from live web search and finds narrative methods", () => {
  const r = searchDesignReferences({ query: "剧情", topic: "story" });
  assert.equal(r.liveSearch, false);
  assert.ok(r.results.some((r) => r.id === "ink-writing"));
  assert.ok(r.results.every((r) => r.reuse));
  assert.equal(
    searchDesignReferences({ query: "no-such-technique" }).results.length,
    0,
  );
});
test("reference reader fetches only indexed sources, strips active markup and supports cached passage lookup", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls++;
    assert.match(url, /gamedesignconcepts.wordpress.com/);
    return new Response(
      "<html><body><script>secretScript()</script><nav>navigation</nav><article><h2>Feedback loops</h2><p>" +
        "A rule changes the available choices and visible consequences. ".repeat(
          25,
        ) +
        "</p></article></body></html>",
    );
  });
  const a = await readDesignReference({
    id: "mechanics-dynamics",
    length: 500,
  });
  assert.ok("text" in a);
  assert.doesNotMatch(a.text!, /secretScript|navigation/);
  assert.ok(a.nextOffset);
  const b = await readDesignReference({
    id: "mechanics-dynamics",
    find: "choices",
    offset: 500,
    length: 500,
  });
  assert.equal(calls, 1);
  assert.equal(b.cached, true);
  assert.match(b.text!, /choices/);
  await assert.rejects(
    readDesignReference({ id: "https://127.0.0.1/private" }),
    /Unknown/,
  );
  assert.equal(calls, 1);
  assert.equal(
    extractReferenceText("# Markdown\n~ score = 1", true),
    "# Markdown\n~ score = 1",
  );
});
test("reference redirect to another host is refused before following", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://example.com/private" },
    });
  });
  await assert.rejects(
    readDesignReference({ id: "design-process" }),
    /approved source/,
  );
  assert.equal(calls, 1);
});
