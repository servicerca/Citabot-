import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), mp=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
if(!url||!key) throw new Error("Supabase server configuration missing");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function user(req:Request){const h=req.headers.get("authorization")||"";const jwt=h.replace(/^Bearer\s+/i,"");if(!jwt)return null;const r=await db.auth.getUser(jwt);return r.data.user||null;}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);try{
 if(!mp)return json({ok:false,error:"Mercado Pago no está configurado."},503);
 const u=await user(req);if(!u)return json({ok:false,error:"Sesión inválida."},401);
 const b=await req.json();const businessId=String(b.business_id||"").trim();const mode=String(b.mode||"").trim();
 if(!businessId||!mode)return json({ok:false,error:"Datos incompletos."},400);
 const m=await db.from("business_members").select("role").eq("business_id",businessId).eq("user_id",u.id).maybeSingle();
 if(m.error)throw m.error;if(!m.data||!["owner","admin"].includes(m.data.role))return json({ok:false,error:"No autorizado."},403);
 const email=String(b.payer_email||u.email||"").trim();if(!email.includes("@"))return json({ok:false,error:"Correo inválido."},400);
 if(mode==="premium"){
   const existing=await db.from("subscriptions").select("id,provider_subscription_id,status,plan").eq("business_id",businessId).maybeSingle();if(existing.error)throw existing.error;
   if(existing.data?.provider_subscription_id&&existing.data.status==="active"&&existing.data.plan==="premium")return json({ok:true,already_active:true});
   const oldProviderId=existing.data?.provider_subscription_id?String(existing.data.provider_subscription_id):null;
   const oldPlan=String(existing.data?.plan||"");
   const r=await fetch("https://api.mercadopago.com/preapproval",{method:"POST",headers:{Authorization:"Bearer "+mp,"Content-Type":"application/json"},body:JSON.stringify({reason:"CitaBot Premium",external_reference:"citabot:"+businessId,payer_email:email,auto_recurring:{frequency:1,frequency_type:"months",transaction_amount:69900,currency_id:"COP"},back_url:b.back_url||"https://servicerca.github.io/Citabot-/",status:"pending"})});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json({ok:false,error:d?.message||d?.error||"Mercado Pago rechazó la suscripción."},502);
   if(oldProviderId&&oldPlan==="professional"&&["active","pending"].includes(String(existing.data?.status||""))){
     const cancel=await fetch("https://api.mercadopago.com/preapproval/"+encodeURIComponent(oldProviderId),{method:"PUT",headers:{Authorization:"Bearer "+mp,"Content-Type":"application/json"},body:JSON.stringify({status:"canceled"})});
     if(!cancel.ok){
       console.error("CITABOT_PREMIUM_OLD_SUB_CANCEL_FAILED",await cancel.text().catch(()=>""),oldProviderId);
       if(d?.id){await fetch("https://api.mercadopago.com/preapproval/"+encodeURIComponent(String(d.id)),{method:"PUT",headers:{Authorization:"Bearer "+mp,"Content-Type":"application/json"},body:JSON.stringify({status:"canceled"})}).catch(()=>null);}
       return json({ok:false,error:"No pudimos confirmar la cancelación de la suscripción Profesional anterior. El nuevo intento de Premium fue cancelado para evitar cobros dobles. Conservamos tu plan anterior.",premium_subscription_id:null},502);
     }
   }
   const row={business_id:businessId,plan:"premium",status:"pending",provider:"mercadopago",provider_customer_id:d?.payer_id?String(d.payer_id):null,provider_subscription_id:d?.id?String(d.id):null,current_period_end:d?.next_payment_date||null,updated_at:new Date().toISOString()};
   if(existing.data){const z=await db.from("subscriptions").update(row).eq("business_id",businessId);if(z.error)throw z.error;}else{const z=await db.from("subscriptions").insert(row);if(z.error)throw z.error;}
   return json({ok:true,plan:"premium",subscription_id:d?.id,init_point:d?.init_point,amount:69900});
 }
 if(mode==="boost"){
   const days=Number(b.duration_days);const prices:{[k:string]:number}={7:9900,15:19900,30:34900};if(!prices[days])return json({ok:false,error:"Duración no válida."},400);
   const title="CitaBot · Visibilidad destacada ("+days+" días)";
   const o=await db.from("directory_boost_orders").insert({business_id:businessId,placement:"featured",duration_days:days,amount:prices[days],currency:"COP",status:"pending",provider:"mercadopago"}).select("id").single();if(o.error)throw o.error;
   const ref="citabot-boost:"+o.data.id;
   const pref=await fetch("https://api.mercadopago.com/checkout/preferences",{method:"POST",headers:{Authorization:"Bearer "+mp,"Content-Type":"application/json"},body:JSON.stringify({external_reference:ref,items:[{id:"citabot-directory-boost",title,quantity:1,unit_price:prices[days],currency_id:"COP"}],payer:{email},back_urls:{success:b.back_url||"https://servicerca.github.io/Citabot-/",failure:b.back_url||"https://servicerca.github.io/Citabot-/",pending:b.back_url||"https://servicerca.github.io/Citabot-/"},auto_return:"approved"})});
   const pd=await pref.json().catch(()=>({}));if(!pref.ok){await db.from("directory_boost_orders").delete().eq("id",o.data.id);return json({ok:false,error:pd?.message||"No se pudo crear el pago."},502);}
   await db.from("directory_boost_orders").update({provider_reference:String(pd.id||"")}).eq("id",o.data.id);
   return json({ok:true,mode:"boost",order_id:o.data.id,preference_id:pd.id,init_point:pd.init_point,amount:prices[days],duration_days:days});
 }
 return json({ok:false,error:"Modo no soportado."},400);
}catch(e){return json({ok:false,error:e instanceof Error?e.message:"Error interno"},500)}});