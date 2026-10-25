import test from "node:test";
import assert from "node:assert/strict";
import {formatProjectText, deadlineRemaining} from "./project-editor";

test("formatting keeps surrounding text and selects the editable content", () => {
  assert.deepEqual(formatProjectText("Our project rocks", 4, 11, "bold"), {text: "Our **project** rocks", start: 6, end: 13});
  const link = formatProjectText("See ", 4, 4, "link");
  assert.equal(link.text, "See [Link text](https://example.com)");
  assert.equal(link.text.slice(link.start, link.end), "Link text");
});

test("list formatting covers selected lines without changing following paragraphs", () => {
  const source = "Intro\nBuild\nTest\n\nLater";
  assert.equal(formatProjectText(source, 7, 16, "numbers").text, "Intro\n1. Build\n2. Test\n\nLater");
  assert.equal(formatProjectText("Build", 2, 2, "bullets").text, "- Build");
});

test("countdown uses absolute time, respects offsets, and stops at the deadline", () => {
  const end = "2026-11-01T12:00:00-05:00";
  const timestamp = Date.parse("2026-11-01T17:00:00Z");
  assert.deepEqual(deadlineRemaining(end, timestamp - 90061000), {ended: false, days: 1, hours: 1, minutes: 1, seconds: 1});
  assert.deepEqual(deadlineRemaining(end, timestamp + 5000), {ended: true, days: 0, hours: 0, minutes: 0, seconds: 0});
  assert.equal(deadlineRemaining(end, timestamp - 1)?.seconds, 1);
  assert.equal(deadlineRemaining("not a date", timestamp), null);
});
