import test from "node:test";
import assert from "node:assert/strict";
import {projectInput,projectRequest} from "./project-server";
import {respond} from "./workspace-server";
const valid={name:"Project",description:"**Markdown**",hackathonMode:true,deadline:"2027-01-01T12:00:00-05:00",imageIds:[],revision:0};
test("project input bounds content and images and requires an unambiguous deadline",()=>{
  assert.equal(projectInput(valid).p_deadline,"2027-01-01T17:00:00.000Z");
  assert.equal(projectInput({...valid,hackathonMode:false,deadline:undefined}).p_deadline,null);
  for(const change of [{name:" "},{description:"x".repeat(10001)},{deadline:"2027-01-01T12:00"},{deadline:"invalid"},{revision:-1},{revision:1.1},{imageIds:["../other"]},{imageIds:Array(5).fill("10000000-0000-4000-8000-000000000001")}])
    assert.throws(()=>projectInput({...valid,...change}));
});
test("project routes require a user session before reading or saving",async()=>{
  for(const method of ['GET','POST'])await assert.rejects(projectRequest(new Request('http://localhost/api/workspaces/id/project',{method}),"10000000-0000-4000-8000-000000000001"),/Sign in/);
});
test("stale edits return a conflict that the editor can recover from",async t=>{
  const previous={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY};
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://project-check.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-public';
  t.after(()=>{
    if(previous.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previous.url;
    if(previous.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=previous.key;
  });
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
    if(new URL(String(input)).pathname==='/auth/v1/user')return Response.json({id:'10000000-0000-4000-8000-000000000001'});
    return Response.json({code:'PT409',message:'Project changed; reload before saving'},{status:409});
  });
  const req=new Request('http://localhost/api/workspaces/id/project',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(valid)});
  const response=await respond(()=>projectRequest(req,'10000000-0000-4000-8000-000000000001'));
  assert.equal(response.status,409);assert.match((await response.json()).error,/Someone updated/);
});
