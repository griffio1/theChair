import test from "node:test";
import assert from "node:assert/strict";
import { lastConversation, rememberConversation } from "./chat-selection";

test("remembered conversations are account-scoped navigation IDs, never cached messages", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  const values = new Map<string,string>();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  try {
    const w="10000000-0000-4000-8000-000000000001",c="10000000-0000-4000-8000-000000000002";
    rememberConversation("a",w,c);
    assert.deepEqual(lastConversation("a"),{workspaceId:w,chatId:c});
    assert.equal(lastConversation("b"),null);
    assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])),["workspaceId","chatId"]);
    values.set("thechair:last-conversation:a",JSON.stringify({workspaceId:"../../invalid",chatId:c}));
    assert.equal(lastConversation("a"),null);
    values.set("thechair:last-conversation:a","not-json");
    assert.equal(lastConversation("a"),null);
  } finally {
    if(original)Object.defineProperty(globalThis,"localStorage",original);
    else Reflect.deleteProperty(globalThis,"localStorage");
  }
});
