import {respond} from '../../../../../../../../lib/workspace-server';
import {deleteMessage} from '../../../../../../../../lib/message-delete';
export const dynamic='force-dynamic';
export async function DELETE(req:Request,{params}:{params:Promise<{workspaceId:string;conversationId:string;messageId:string}>}){
 const {workspaceId,conversationId,messageId}=await params;
 return respond(()=>deleteMessage(req,workspaceId,conversationId,messageId));
}
