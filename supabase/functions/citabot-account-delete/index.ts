import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
async function authUser(req:Request){const h=req.headers.get("Authorization")||"";if(!h.startsWith("Bearer "))throw new Error("unauthorized");const {data,error}=await admin.auth.getUser(h.slice(7));if(error||!data.user)throw new Error("unauthorized");return data.user;}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return Response.json({ok:false,error:"method_not_allowed"},{status:405,headers:cors});
 try{
  const user=await authUser(req),body=await req.json().catch(()=>({})),mode=String(body?.mode||"").trim();
  if(!["business_profile","account"].includes(mode))return Response.json({ok:false,error:"invalid_mode"},{status:400,headers:cors});
  if(mode==="business_profile"){
   const businessId=String(body?.business_id||"").trim();if(!businessId)return Response.json({ok:false,error:"business_id_required"},{status:400,headers:cors});
   const {data:business,error:be}=await admin.from("businesses").select("id,owner_id,is_active").eq("id",businessId).maybeSingle();if(be)throw be;
   if(!business||business.owner_id!==user.id)return Response.json({ok:false,error:"forbidden"},{status:403,headers:cors});
   const {error:ue}=await admin.from("businesses").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",businessId);if(ue)throw ue;
   const {error:me}=await admin.from("business_members").delete().eq("business_id",businessId).eq("user_id",user.id);if(me)throw me;
   return Response.json({ok:true,mode,message:"business_profile_deactivated"},{status:200,headers:cors});
  }
  const {data:ownedBusinesses,error:oe}=await admin.from("businesses").select("id").eq("owner_id",user.id);if(oe)throw oe;
  const businessIds=(ownedBusinesses||[]).map((x)=>x.id);
  if(businessIds.length){
   const {error:le}=await admin.from("legal_acceptances").delete().in("business_id",businessIds);if(le)throw le;
   const {error:re}=await admin.from("platform_revenue").update({business_id:null}).in("business_id",businessIds);if(re)throw re;
   for(const table of ["business_directory","messages","campaigns","payments","subscriptions","appointments","business_integrations","business_hours","staff","services","customers","business_promotions","directory_boost_orders","business_members"]){
    const {error}=await admin.from(table).delete().in("business_id",businessIds);if(error)throw error;
   }
   const {error:be}=await admin.from("businesses").delete().in("id",businessIds);if(be)throw be;
  }
  const {error:me}=await admin.from("business_members").delete().eq("user_id",user.id);if(me)throw me;
  const {error:leu}=await admin.from("legal_acceptances").delete().eq("user_id",user.id);if(leu)throw leu;
  const {error:acu}=await admin.from("appointments").update({client_id:null}).eq("client_id",user.id);if(acu)throw acu;
  const {error:pe}=await admin.from("profiles").delete().eq("id",user.id);if(pe)throw pe;
  const {error:ae}=await admin.auth.admin.deleteUser(user.id);if(ae)throw ae;
  return Response.json({ok:true,mode,message:"account_deleted"},{status:200,headers:cors});
 }catch(e){const m=e instanceof Error?e.message:"request_failed";const status=m==="unauthorized"?401:500;return Response.json({ok:false,error:status===401?"unauthorized":"delete_failed"},{status,headers:cors});}
});