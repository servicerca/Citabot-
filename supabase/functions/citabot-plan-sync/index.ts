import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if(!url||!key)throw new Error("Supabase server configuration missing");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);
 try{
  const h=req.headers.get("authorization")||"",jwt=h.replace(/^Bearer\s+/i,"");if(!jwt)return json({ok:false,error:"Sesión inválida."},401);
  const ar=await db.auth.getUser(jwt);const u=ar.data.user;if(ar.error||!u)return json({ok:false,error:"Sesión inválida."},401);
  const b=await req.json().catch(()=>({}));const bid=String(b.business_id||"").trim();if(!bid)return json({ok:false,error:"Negocio requerido."},400);
  const m=await db.from("business_members").select("role").eq("business_id",bid).eq("user_id",u.id).maybeSingle();if(m.error)throw m.error;if(!m.data||!["owner","admin"].includes(m.data.role))return json({ok:false,error:"No tienes permisos para sincronizar el plan."},403);
  const s=await db.from("subscriptions").select("*").eq("business_id",bid).maybeSingle();if(s.error)throw s.error;
  if(!s.data){
    const trialEnds=new Date(Date.now()+7*86400000).toISOString(),started=new Date().toISOString();
    const z=await db.from("subscriptions").insert({business_id:bid,plan:"trial",status:"trialing",trial_started_at:started,trial_ends_at:trialEnds,provider:"citabot"}).select("*").single();if(z.error)throw z.error;
    return json({ok:true,subscription:z.data,action:"trial_started"});
  }
  const sub=s.data;
  if(sub.plan==="trial" && sub.status==="trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at)<=new Date()){
    const z=await db.from("subscriptions").update({plan:"free",status:"active",trial_ends_at:null,updated_at:new Date().toISOString()}).eq("id",sub.id).select("*").single();if(z.error)throw z.error;
    return json({ok:true,subscription:z.data,action:"trial_expired"});
  }
  if(sub.plan==="free" && !sub.trial_started_at){
    const started=new Date(),ends=new Date(started.getTime()+7*86400000);
    const z=await db.from("subscriptions").update({plan:"trial",status:"trialing",trial_started_at:started.toISOString(),trial_ends_at:ends.toISOString(),updated_at:started.toISOString()}).eq("id",sub.id).select("*").single();if(z.error)throw z.error;
    return json({ok:true,subscription:z.data,action:"trial_started"});
  }
  return json({ok:true,subscription:sub,action:"unchanged"});
 }catch(e){console.error("CITABOT_PLAN_SYNC_ERROR",e);return json({ok:false,error:e instanceof Error?e.message:"Error interno"},500);}
});