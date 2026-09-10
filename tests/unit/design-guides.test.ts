import assert from "node:assert/strict";
import { test } from "node:test";
import {
  designTopics,
  readDesignGuide,
  type DesignTopic,
} from "../../src/agent/design-guides.js";

test("shipped design knowledge is readable offline and cannot traverse to another file", () => {
  for (const topic of designTopics) {
    const guide = readDesignGuide(topic);
    assert.ok(guide.length > 500 && guide.length < 16000);
    assert.match(guide, /https:\/\//);
  }
  assert.throws(
    () => readDesignGuide("../../package" as DesignTopic),
    /Unknown/,
  );
});
