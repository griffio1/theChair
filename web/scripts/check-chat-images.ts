// node --env-file=web/.env.local --import tsx web/scripts/check-chat-images.ts
// Uses disposable accounts/workspaces; does not send emails or log credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const origin=process.env.WORKSPACE_CHECK_URL ?? "http://localhost:3000";
const url=process.env.SUPABASE_URL!, key=process.env.SUPABASE_SERVICE_KEY!;
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const users:string[]=[],spaces:string[]=[];
async function account(label:string){
  const email=`chair-image-${randomBytes(8).toString("hex")}@example.com`,password=randomBytes(32).toString("hex");
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{displayName:label}});
  if(created.error || !created.data.user)throw new Error("Test account creation failed");
  users.push(created.data.user.id);
  const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email,password});
  if(!login.data.session)throw new Error("Test account sign-in failed");
  return {id:created.data.user.id,token:login.data.session.access_token};
}
async function request(path:string,token?:string,body?:object|FormData){
  return fetch(origin+path,{method:body?"POST":"GET",headers:{...(token?{authorization:`Bearer ${token}`} :{}),
    ...(body && !(body instanceof FormData)?{"content-type":"application/json"}:{})},
    body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
}
async function ok(response:Response,label:string){
  assert.equal(response.status,200,label); return response.json();
}
async function main(){
  try {
    const owner=await account("Image owner"),member=await account("Image member"),outsider=await account("Image outsider");
    const w=await ok(await request("/api/workspaces",owner.token,{name:"Disposable image check"}),"create workspace");
    spaces.push(w.workspace.id);
    const w2=await ok(await request("/api/workspaces",owner.token,{name:"Disposable image isolation"}),"create other workspace");
    spaces.push(w2.workspace.id);
    const joined=await admin.from("chair_memberships").insert({workspace_id:w.workspace.id,user_id:member.id,display_name:"Image member",role:"member"});
    assert.equal(joined.error,null,"test membership");
    const base=`/api/workspaces/${w.workspace.id}`,chat=`${base}/chats/${w.chat.id}/messages`;
    const png=await sharp({create:{width:32,height:24,channels:3,background:"purple"}}).png().toBuffer();
    function upload(bytes:Buffer=png,id=randomUUID()){
      const form=new FormData();form.set("file",new File([new Uint8Array(bytes)],"sample.png",{type:"image/png"}));form.set("clientUploadId",id);return form;
    }
    assert.equal((await request(`${base}/images`,undefined,upload())).status,401);
    assert.equal((await request(`${base}/images`,outsider.token,upload())).status,404);
    assert.equal((await request(`${base}/images`,owner.token,upload(Buffer.from("not png")))).status,400);
    assert.equal((await request(`${base}/images`,owner.token,upload(Buffer.alloc(3*1024*1024+1)))).status,413);
    const clientUploadId=randomUUID();
    const retries=await Promise.all([request(`${base}/images`,owner.token,upload(png,clientUploadId)),request(`${base}/images`,owner.token,upload(png,clientUploadId))]);
    const first=await ok(retries[0],"upload"),again=await ok(retries[1],"concurrent upload retry");
    assert.equal(first.image.id,again.image.id);
    const path=`${base}/images/${first.image.id}`;
    assert.equal((await request(path,member.token)).status,404,"members cannot see unsent drafts");
    const preview=await request(path,owner.token);assert.equal(preview.status,200);assert.equal(preview.headers.get("content-type"),"image/webp");
    assert.match(preview.headers.get("cache-control")!,/no-store/);
    const metadata=await sharp(Buffer.from(await preview.arrayBuffer())).metadata();assert.equal(metadata.width,32);
    const stored=await admin.from("chair_chat_images").select("object_path").eq("id",first.image.id).single();
    assert.equal(stored.error,null);
    const publicRead=await fetch(`${url}/storage/v1/object/public/chair-chat-images/${stored.data!.object_path}`);
    assert.notEqual(publicRead.status,200,"bucket must be private");
    const payload={body:"",clientMessageId:randomUUID(),imageIds:[first.image.id]};
    assert.equal((await request(chat,member.token,payload)).status,403,"cannot attach someone else's upload");
    assert.equal((await request(`/api/workspaces/${w2.workspace.id}/chats/${w2.chat.id}/messages`,owner.token,payload)).status,403,"cannot attach across workspaces");
    const sent=await Promise.all([request(chat,owner.token,payload),request(chat,owner.token,payload)]);
    const one=await ok(sent[0],"image-only message"),two=await ok(sent[1],"concurrent message retry");
    assert.equal(one.messages[0].id,two.messages[0].id);assert.equal(one.messages[0].images[0].id,first.image.id);
    assert.equal((await request(path,member.token)).status,200);
    assert.equal((await request(path,outsider.token)).status,404);
    assert.equal((await request(path)).status,401);
    assert.equal((await request(`/api/workspaces/${w2.workspace.id}/images/${first.image.id}`,owner.token)).status,404);
    const history=await ok(await request(chat,member.token),"history");assert.equal(history.messages[0].images[0].id,first.image.id);
    const other=await ok(await request(`${base}/images`,member.token,upload()),"member upload");
    const teamPayload={body:"Team image caption",clientMessageId:randomUUID(),imageIds:[other.image.id]};
    const team=await ok(await request(`${base}/team/images`,member.token,teamPayload),"team image message");
    const teamAgain=await ok(await request(`${base}/team/images`,member.token,teamPayload),"team retry");assert.equal(team.messages[0].id,teamAgain.messages[0].id);
    assert.equal((await request(`${base}/images/${other.image.id}`,owner.token)).status,200);
    await admin.from("chair_memberships").delete().eq("workspace_id",w.workspace.id).eq("user_id",member.id);
    assert.equal((await request(path,member.token)).status,404,"revoked members lose access");
    await ok(await request(chat,owner.token,{body:"Text remains supported",clientMessageId:randomUUID()}),"text compatibility");
    console.log("PASS: real private upload, image validation, concurrent retries, workspace/team posts, history, outsider isolation and membership revocation.");
  } finally {
    for(const id of spaces){
      const rows=await admin.from("chair_chat_images").select("object_path").eq("workspace_id",id);
      if(rows.error)throw new Error("Could not enumerate disposable images for cleanup");
      if(rows.data.length){const removed=await admin.storage.from("chair-chat-images").remove(rows.data.map(r=>r.object_path));if(removed.error)throw new Error("Test image cleanup failed");}
      const removed=await admin.from("chair_workspaces").delete().eq("id",id);if(removed.error)throw new Error("Test workspace cleanup failed");
    }
    for(const id of users){const removed=await admin.auth.admin.deleteUser(id);if(removed.error)throw new Error("Test account cleanup failed");}
    console.log("PASS: disposable image test data removed.");
  }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Image check failed");process.exitCode=1;});
