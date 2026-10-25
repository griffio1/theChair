import {respond} from '../../../../../lib/workspace-server';
import {respondInvitation} from '../../../../../lib/identity-server';
export const dynamic='force-dynamic';
export async function POST(req:Request,context:{params:Promise<{invitationId:string}>}){const {invitationId}=await context.params;return respond(()=>respondInvitation(req,invitationId));}
