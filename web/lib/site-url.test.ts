import test from "node:test";
import assert from "node:assert/strict";
import { publicSiteOrigin, shareUrl } from "./site-url";
test("shared URLs use the configured deployment without leaking credentials or retaining paths", () => {
  assert.equal(
    publicSiteOrigin(
      "http://localhost:3000/api",
      "https://chair.example/workspaces",
    ),
    "https://chair.example",
  );
  assert.equal(
    publicSiteOrigin("https://preview.example/api"),
    "https://preview.example",
  );
  assert.throws(() =>
    publicSiteOrigin(
      "http://localhost:3000",
      "https://user:secret@chair.example",
    ),
  );
  assert.throws(() =>
    publicSiteOrigin("http://localhost:3000", "javascript:alert(1)"),
  );
});
test("local invitations and webhook setup target the public API, while deployed requests keep their own origin", (t) => {
  const before = {
    api: process.env.THECHAIR_API_URL,
    site: process.env.THECHAIR_PUBLIC_URL,
  };
  process.env.THECHAIR_API_URL = "https://chair.example";
  delete process.env.THECHAIR_PUBLIC_URL;
  t.after(() => {
    for (const [k, v] of [
      ["THECHAIR_API_URL", before.api],
      ["THECHAIR_PUBLIC_URL", before.site],
    ]) {
      if (v === undefined) delete process.env[k!];
      else process.env[k!] = v;
    }
  });
  assert.equal(
    shareUrl("/workspaces#invite=abc", "http://localhost:3000/api"),
    "https://chair.example/workspaces#invite=abc",
  );
  assert.equal(
    shareUrl("/api/github/webhook", "http://localhost:3000/api"),
    "https://chair.example/api/github/webhook",
  );
  assert.equal(
    shareUrl("/workspaces", "https://preview.example/api"),
    "https://preview.example/workspaces",
  );
});
