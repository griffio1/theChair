import {authenticate,readBody,validId,WorkspaceError} from './workspace-server';
import {adminDatabase} from './workspace-integrations';

export async function deleteWorkspace(req:Request,workspaceId:string){
 const {db}=await authenticate(req),body=await readBody(req);
 if(typeof body.name!=='string'||!body.name||body.name.length>80)throw new WorkspaceError(400,'Type the workspace name.');
 const {data,error}=await db.rpc('chair_delete_workspace',{p_workspace:validId(workspaceId),p_name:body.name});
 if(error?.code==='42501')throw new WorkspaceError(403,'Only owners can delete this workspace.');
 if(error?.code==='22023')throw new WorkspaceError(400,'The name does not match. Check the current workspace name.');
 if(error||data!==true)throw new WorkspaceError(503,'Could not confirm deletion. Refresh before trying again.');
 return {deleted:true};
}

/** Private objects remain inaccessible after deletion; cron retries physical removal. */
export async function removeWorkspaceFiles():Promise<{processed:number;failed:number}>{
 const db=adminDatabase();
 const pending=await db.from('chair_file_removals').select('id,workspace_id,bucket,object_path').lte('available_at',new Date().toISOString()).order('available_at').limit(100);
 if(pending.error)return {processed:0,failed:1};
 let processed=0,failed=0;
 for(const bucket of ['chair-chat-images','chair-project-images']){
  const rows=(pending.data??[]).filter(row=>row.bucket===bucket&&row.object_path.startsWith(row.workspace_id+'/')&&!row.object_path.includes('..'));
  if(!rows.length)continue;
  const result=await db.storage.from(bucket).remove(rows.map(row=>row.object_path));
  if(result.error){failed+=rows.length;continue;}
  const removed=await db.from('chair_file_removals').delete().in('id',rows.map(row=>row.id));
  if(removed.error)failed+=rows.length;else processed+=rows.length;
 }
 return {processed,failed};
}
