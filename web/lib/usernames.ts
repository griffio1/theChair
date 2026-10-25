const reserved=new Set(['admin','administrator','support','thechair','system','moderator']);
export const normalizeUsername=(value:string)=>value.trim().replace(/^@/,'').toLowerCase();
export function usernameError(value:string){
  const username=normalizeUsername(value);
  return !/^[a-z0-9_]{3,30}$/.test(username)?'Use 3–30 letters, numbers, or underscores.':reserved.has(username)?'Choose a different username.':'';
}
export interface AccountProfile {userId:string;displayName:string;username:string|null}
export interface InviteNotification {id:string;workspaceName:string;inviterName:string;inviterUsername:string|null;status:'pending'|'accepted'|'declined'|'expired';seen:boolean;createdAt:string;expiresAt:string}
