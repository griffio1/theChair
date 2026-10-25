import {respond} from '../../../../lib/workspace-server';
import {usernameAvailability} from '../../../../lib/identity-server';
export const dynamic='force-dynamic';
export async function GET(req:Request,context:{params:Promise<{username:string}>}){const {username}=await context.params;return respond(()=>usernameAvailability(req,username));}
