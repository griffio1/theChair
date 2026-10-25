import {supabase} from './supabase';
export async function identityRequest<T>(path:string,userId:string,body?:object,signal?:AbortSignal):Promise<T>{
 const {data}=await supabase.auth.getSession();
 if(data.session?.user.id!==userId)throw new Error('Sign in again to continue.');
 const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{authorization:`Bearer ${data.session.access_token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(15000)])});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error || 'Could not finish. Try again.');
 return result;
}
