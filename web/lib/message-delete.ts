import {authenticate,validId,WorkspaceError} from './workspace-server';
export async function deleteMessage(req:Request,workspaceId:string,conversationId:string,messageId:string){
 const {db}=await authenticate(req);
 const {data,error}=await db.rpc('chair_delete_message',{p_workspace:validId(workspaceId),p_chat:conversationId==='team'?null:validId(conversationId),p_message:validId(messageId)});
 if(error?.code==='42501')throw new WorkspaceError(403,'You can only delete your own messages.');
 if(error||data!==true)throw new WorkspaceError(503,'Could not delete the message. Try again.');
 return {deleted:true};
}
