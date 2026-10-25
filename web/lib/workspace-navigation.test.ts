import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceLocation, workspaceHref, type WorkspaceView } from "./workspace-navigation";
const space = "11111111-1111-4111-8111-111111111111";
const chat = "22222222-2222-4222-8222-222222222222";

test("workspace links preserve selection across reloads and browser history", () => {
  for (const view of ["team", "chat", "home", "people", "contracts", "conflicts", "connections"] as WorkspaceView[]) {
    const url = new URL(workspaceHref(space, view, chat), "https://example.com");
    assert.deepEqual(readWorkspaceLocation(url.search), {workspaceId: space, view, chatId: view === "chat" ? chat : ""});
  }
});
test("missing or invalid destinations open team chat without accepting outside URLs", () => {
  assert.deepEqual(readWorkspaceLocation("?workspace=https://example.org&view=unknown&chat=../x"), {workspaceId: "", chatId: "", view: "team"});
  assert.equal(workspaceHref("//example.org"), "/workspaces?view=team");
  assert.equal(readWorkspaceLocation("").view, "team");
});
