import {respond} from '../../../../lib/workspace-server';
import {profileRequest} from '../../../../lib/identity-server';
export const dynamic='force-dynamic';
export async function GET(req:Request){return respond(()=>profileRequest(req));}
export const POST=GET;
