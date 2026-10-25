import {respond} from '../../../../lib/workspace-server';
import {notificationsRequest} from '../../../../lib/identity-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){return respond(()=>notificationsRequest(req));}
