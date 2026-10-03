import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const SUPABASE_URL=Deno.env.get("SUPABASE_URL");const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");const MP_TOKEN=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");const PUBLIC_URL=Deno.env.get("CITABOT_PUBLIC_URL")||"https://servicerca.github.io/Citabot-/";
if(!SUPABASE_URL||!SERVICE_ROLE_KEY)throw new Error("Supabase server configuration missing");
const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);try{
 if(!MP_TOKEN)return json({ok:false,error:"Mercado Pago todavía no está configurado en el servidor."},503);
 const auth=req.headers.get("authorization")||"";const token=auth.replace(/^Bearer\s+/i,"");if(!token)return json({ok:false,error:"Sesión requerida."},401);
 const {data:{user},error:ue}=await admin.auth.getUser(token);if(ue||!user)return json({ok:false,error:"Sesión inválida."},401);
 const body=await req.json();const businessId=String(body?.business_id||"").trim();const plan=String(body?.plan||"professional").trim().toLowerCase();
 if(!businessId)return json({ok:false,error:"Negocio requerido."},400);if(plan!=="professional")return json({ok:false,error:"Plan todavía no configurado para cobro automático."},400);
 const {data:member,error:me}=await admin.from("business_members").select("role").eq("business_id",businessId).eq("user_id",user.id).maybeSingle();if(me)throw me;if(!member||!['owner','admin'].includes(member.role))return json({ok:false,error:"No tienes permisos para gestionar la suscripción."},403);
 const payerEmail=String(body?.payer_email||user.email||"").trim();if(!payerEmail||!payerEmail.includes("@"))return json({ok:false,error:"Necesitamos un correo válido para Mercado Pago."},400);
 const amount=59900;const reference=`citabot:${businessId}`;
 const existing=await admin.from("subscriptions").select("id,provider_subscription_id,status,plan").eq("business_id",businessId).maybeSingle();if(existing.error)throw existing.error;
 if(existing.data?.provider_subscription_id&&existing.data.status==='active')return json({ok:true,already_active:true,subscription_id:existing.data.provider_subscription_id,status:'active'});
 if(existing.data?.provider_subscription_id&&existing.data.status==='pending')return json({ok:true,already_pending:true,subscription_id:existing.data.provider_subscription_id,status:'pending'});
 const mp=await fetch("https://api.mercadopago.com/preapproval",{method:"POST",headers:{Authorization:`Bearer ${MP_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({reason:"CitaBot Profesional",external_reference:reference,payer_email:payerEmail,auto_recurring:{frequency:1,frequency_type:"months",transaction_amount:amount,currency_id:"COP"},back_url:PUBLIC_URL,status:"pending"})});
 const data=await mp.json().catch(()=>({}));if(!mp.ok)return json({ok:false,error:data?.message||data?.error||"Mercado Pago rechazó la creación de la suscripción."},502);
 const sub={business_id:businessId,plan:"professional",status:"pending",provider:"mercadopago",provider_customer_id:data?.payer_id?String(data.payer_id):null,provider_subscription_id:data?.id?String(data.id):null,current_period_end:data?.next_payment_date||null,updated_at:new Date().toISOString()};
 if(existing.data){const {error}=await admin.from("subscriptions").update(sub).eq("business_id",businessId);if(error)throw error;}else{const {error}=await admin.from("subscriptions").insert(sub);if(error)throw error;}
 return json({ok:true,subscription_id:data?.id,init_point:data?.init_point,status:data?.status||"pending",plan:"professional",amount});
}catch(e){return json({ok:false,error:e instanceof Error?e.message:"Error interno"},500)}});