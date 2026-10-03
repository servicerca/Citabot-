import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
 try{const auth=req.headers.get("Authorization")||"",jwt=auth.startsWith("Bearer ")?auth.slice(7):"";if(!jwt)return new Response(JSON.stringify({error:"No autenticado"}),{status:401,headers:{...cors,"Content-Type":"application/json"}});const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw Error("Configuración interna incompleta");const admin=createClient(url,key,{auth:{persistSession:false}}),ar=await admin.auth.getUser(jwt),user=ar.data.user;if(ar.error||!user)return new Response(JSON.stringify({error:"Sesión no válida"}),{status:401,headers:{...cors,"Content-Type":"application/json"}});const body=await req.json(),businessId=String(body.business_id||"").trim(),input=String(body.input??body.prompt??body.question??"").trim();if(!businessId)return new Response(JSON.stringify({error:"Falta business_id"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});if(!input)return new Response(JSON.stringify({error:"Falta input"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});const mr=await admin.from("business_members").select("role").eq("business_id",businessId).eq("user_id",user.id).maybeSingle();if(mr.error||!mr.data)return new Response(JSON.stringify({error:"Sin acceso a este negocio"}),{status:403,headers:{...cors,"Content-Type":"application/json"}});const sr=await admin.from("subscriptions").select("plan,status,trial_ends_at").eq("business_id",businessId).maybeSingle();if(sr.error)throw sr.error;const paid=((sr.data?.status === "active" && ["professional","premium"].includes(String(sr.data?.plan || "").toLowerCase())) || (sr.data?.status === "trialing" && sr.data?.plan === "trial" && sr.data?.trial_ends_at && new Date(sr.data.trial_ends_at)>new Date()));if(!paid)return new Response(JSON.stringify({error:"La IA de CitaBot está disponible desde el plan Profesional."}),{status:403,headers:{...cors,"Content-Type":"application/json"}});const br=await admin.from("businesses").select("name").eq("id",businessId).maybeSingle(),businessName=br.data?.name||"negocio";const apiKey=Deno.env.get("OPENAI_API_KEY"),model=Deno.env.get("OPENAI_MODEL");if(!apiKey||!model)return new Response(JSON.stringify({error:"IA no configurada"}),{status:503,headers:{...cors,"Content-Type":"application/json"}});const context=body.context?"\nContexto de CitaBot:\n"+JSON.stringify(body.context):"",system="Eres el asistente de negocios de CitaBot. Responde en español, claro, breve y útil. No inventes datos. Si no tienes un dato, dilo y pide la información necesaria. No prometas reservas, precios o disponibilidad que no estén confirmados.";let rr=null;let data={};let lastProviderError="";
for(let attempt=0;attempt<3;attempt++){
  try{
    rr=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,
        input:system+"\nNegocio: "+String(businessName)+context+"\n\nSolicitud:\n"+input,
        max_output_tokens:300
      })
    });
    data=await rr.json().catch(()=>({}));
    if(rr.ok) break;
    lastProviderError=String(data?.error?.message||("HTTP "+rr.status));
    if(![429,500,502,503,504].includes(rr.status)) break;
  }catch(e){
    lastProviderError=e instanceof Error?e.message:"Error de conexión";
  }
  if(attempt<2) await new Promise(r=>setTimeout(r,400*(attempt+1)));
}
if(!rr?.ok){
  console.error("CITABOT_AI_PROVIDER_FAILED",{status:rr?.status||null,error:lastProviderError,attempts:3});
  return new Response(JSON.stringify({
    ok:false,
    degraded:true,
    error:"La IA no está disponible temporalmente. La agenda, clientes y demás funciones de CitaBot siguen operativas.",
    provider_status:rr?.status||null
  }),{headers:{...cors,"Content-Type":"application/json"}});
}
const text=data.output_text??data.output?.flatMap((x:any)=>x.content??[]).map((x:any)=>x.text??"").join("")??"";
return new Response(JSON.stringify({ok:true,text,provider:"openai",model}),{headers:{...cors,"Content-Type":"application/json"}});
}catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:"Error interno"}),{status:500,headers:{...cors,"Content-Type":"application/json"}});}});