import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../../shared/types";
import { mergeTeamMessages, teamMessageRows } from "./team-messages";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const message = (n: number, changes: Partial<Message> = {}): Message => ({
  id: id(n), author: {type:"human",name:"Carter"}, kind:"text", body:`Message ${n}`,
  createdAt: `2026-10-24T12:00:00.000Z`, ...changes,
});

test("a delayed snapshot cannot restore deleted message contents", () => {
  const [original]=teamMessageRows([message(1)]);
  const removed={...original,body:"Message deleted",images:[],deleted_at:"2026-10-25T12:00:00Z"};
  assert.deepEqual(mergeTeamMessages([removed],[original]),[removed]);
  assert.deepEqual(mergeTeamMessages([original],[removed]),[removed]);
});

test("API replies show persisted messages and wait for the ledger's real proposal UUID", () => {
  const reply = [message(1), message(2, {id:"auth-login@2",kind:"contract_proposal",refId:"auth-login@2"}),
    message(3, {author:{type:"ai",name:"theChair AI"}})];
  const immediate = teamMessageRows(reply);
  assert.deepEqual(immediate.map(row => row.id), [id(1),id(3)]);
  const persisted = teamMessageRows([message(1), message(2, {kind:"contract_proposal",refId:"auth-login@2",author:{type:"system",name:"theChair"}}), reply[2]]);
  for (const rows of [mergeTeamMessages(immediate,persisted), mergeTeamMessages(persisted,immediate)]) {
    assert.deepEqual(rows.map(row => row.id), [id(1),id(2),id(3)]);
    assert.equal(rows.filter(row => row.kind === "contract_proposal").length, 1);
    assert.equal(rows.find(row => row.kind === "contract_proposal")?.ref_id, "auth-login@2");
  }
});

test("API message mapping keeps image attachments and author details", () => {
  const images = [{id:id(5),name:"screenshot.webp",mimeType:"image/webp" as const,width:10,height:20,size:100}];
  const [row] = teamMessageRows([{...message(4),images}]);
  assert.deepEqual(row.images, images);
  assert.equal(row.author_name,"Carter");
  assert.equal(row.author_type,"human");
  assert.equal(row.created_at,"2026-10-24T12:00:00.000Z");
});

test("message resync stays ordered, replaces duplicate IDs, and keeps the latest 200", () => {
  const previous = teamMessageRows(Array.from({length:200},(_,n) => message(n+1)));
  const incoming = teamMessageRows([message(200,{body:"Updated"}),message(201)]);
  const merged = mergeTeamMessages(previous,incoming);
  assert.equal(merged.length,200);
  assert.equal(merged[0].id,id(2));
  assert.equal(merged[199].id,id(201));
  assert.equal(merged.find(row => row.id === id(200))?.body,"Updated");
  assert.equal(previous[199].body,"Message 200");
});
