import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateAiRequest } from "./request-validation.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
 try{const auth=req.headers.get("Authorization")||"",jwt=auth.startsWith("Bearer ")?auth.slice(7):"";if(!jwt)return new Response(JSON.stringify({error:"No autenticado"}),{status:401,headers:{...cors,"Content-Type":"application/json"}});const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw Error("Configuración interna incompleta");const admin=createClient(url,key,{auth:{persistSession:false}}),ar=await admin.auth.getUser(jwt),user=ar.data.user;if(ar.error||!user)return new Response(JSON.stringify({error:"Sesión no válida"}),{status:401,headers:{...cors,"Content-Type":"application/json"}});const parsedBody=await req.json().catch(()=>null),validated=validateAiRequest(parsedBody);if(!validated.ok)return new Response(JSON.stringify({error:validated.error}),{status:validated.status,headers:{...cors,"Content-Type":"application/json"}});const {businessId,input,serializedContext}=validated;const mr=await admin.from("business_members").select("role").eq("business_id",businessId).eq("user_id",user.id).maybeSingle();if(mr.error||!mr.data)return new Response(JSON.stringify({error:"Sin acceso a este negocio"}),{status:403,headers:{...cors,"Content-Type":"application/json"}});const sr=await admin.from("subscriptions").select("plan,status,trial_ends_at").eq("business_id",businessId).maybeSingle();if(sr.error)throw sr.error;const paid=((sr.data?.status === "active" && ["professional","premium"].includes(String(sr.data?.plan || "").toLowerCase())) || (sr.data?.status === "trialing" && sr.data?.plan === "trial" && sr.data?.trial_ends_at && new Date(sr.data.trial_ends_at)>new Date()));if(!paid)return new Response(JSON.stringify({error:"La IA de CitaBot está disponible desde el plan Profesional."}),{status:403,headers:{...cors,"Content-Type":"application/json"}});const br=await admin.from("businesses").select("name").eq("id",businessId).maybeSingle(),businessName=br.data?.name||"negocio";const apiKey=Deno.env.get("OPENAI_API_KEY"),model=Deno.env.get("OPENAI_MODEL");if(!apiKey||!model)return new Response(JSON.stringify({error:"IA no configurada"}),{status:503,headers:{...cors,"Content-Type":"application/json"}});const context=serializedContext?"\nContexto de CitaBot:\n"+serializedContext:"",system="Eres el asistente de negocios de CitaBot. Responde en español, claro, breve y útil. No inventes datos. Si no tienes un dato, dilo y pide la información necesaria. No prometas reservas, precios o disponibilidad que no estén confirmados.";let rr:Response|null=null;let data:any={};
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
    if(![429,500,502,503,504].includes(rr.status)) break;
  }catch(e){
  }
  if(attempt<2) await new Promise(r=>setTimeout(r,400*(attempt+1)));
}
if(!rr?.ok){
  console.error("CITABOT_AI_PROVIDER_FAILED",{status:rr?.status||null,attempts:3});
  return new Response(JSON.stringify({
    ok:false,
    degraded:true,
    error:"La IA no está disponible temporalmente. La agenda, clientes y demás funciones de CitaBot siguen operativas.",
    provider_status:rr?.status||null
  }),{status:503,headers:{...cors,"Content-Type":"application/json"}});
}
const text=data.output_text??data.output?.flatMap((x:any)=>x.content??[]).map((x:any)=>x.text??"").join("")??"";
return new Response(JSON.stringify({ok:true,text,provider:"openai",model}),{headers:{...cors,"Content-Type":"application/json"}});
}catch(e){console.error("CITABOT_AI_INTERNAL_FAILURE",e instanceof Error?e.name:"UnknownError");return new Response(JSON.stringify({error:"No se pudo procesar la solicitud de IA temporalmente."}),{status:500,headers:{...cors,"Content-Type":"application/json"}});}});