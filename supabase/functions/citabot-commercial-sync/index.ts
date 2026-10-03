import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),mp=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
if(!url||!key)throw new Error("Supabase server configuration missing");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function getUser(req:Request){const h=req.headers.get("authorization")||"",jwt=h.replace(/^Bearer\s+/i,"");if(!jwt)return null;const r=await db.auth.getUser(jwt);return r.data.user||null;}
async function mpGet(path:string){if(!mp)throw new Error("Mercado Pago no está configurado.");const r=await fetch("https://api.mercadopago.com"+path,{headers:{Authorization:"Bearer "+mp}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.message||"Mercado Pago no respondió correctamente.");return d;}
function subStatus(s:string){return s==="authorized"?"active":s==="paused"?"paused":s==="cancelled"||s==="canceled"?"cancelled":s==="pending"?"pending":"past_due";}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);try{
 const user=await getUser(req);if(!user)return json({ok:false,error:"Sesión inválida."},401);
 const body=await req.json().catch(()=>({}));const businessId=String(body.business_id||"").trim();if(!businessId)return json({ok:false,error:"Negocio requerido."},400);
 const m=await db.from("business_members").select("role").eq("business_id",businessId).eq("user_id",user.id).maybeSingle();if(m.error)throw m.error;if(!m.data||!["owner","admin"].includes(m.data.role))return json({ok:false,error:"No autorizado."},403);
 if(!mp)return json({ok:false,error:"Mercado Pago no está configurado."},503);
 let premium=null,boosts:any[]=[];
 const sub=await db.from("subscriptions").select("id,plan,status,provider,provider_subscription_id").eq("business_id",businessId).maybeSingle();if(sub.error)throw sub.error;
 if(sub.data?.provider==="mercadopago"&&sub.data.provider_subscription_id){
   const remote=await mpGet("/preapproval/"+encodeURIComponent(String(sub.data.provider_subscription_id)));
   const status=subStatus(String(remote.status||"pending"));
   if(sub.data.status!==status)await db.from("subscriptions").update({status,current_period_end:remote?.next_payment_date||remote?.auto_recurring?.end_date||null,updated_at:new Date().toISOString()}).eq("id",sub.data.id);
   premium={plan:sub.data.plan,status,provider_subscription_id:sub.data.provider_subscription_id};
   if(status==="active"&&sub.data.plan==="premium")premium={...premium,verified:true};
 }
 const orders=await db.from("directory_boost_orders").select("id,business_id,duration_days,amount,status,provider,provider_reference,provider_transaction_id").eq("business_id",businessId).eq("status","pending").order("created_at",{ascending:false}).limit(10);if(orders.error)throw orders.error;
 for(const order of orders.data||[]){
   const ref="citabot-boost:"+order.id;
   const now=new Date(),begin=new Date(now.getTime()-7*86400000).toISOString(),end=new Date(now.getTime()+86400000).toISOString();
   const path="/v1/payments/search?sort=date_created&criteria=desc&external_reference="+encodeURIComponent(ref)+"&range=date_created&begin_date="+encodeURIComponent(begin)+"&end_date="+encodeURIComponent(end);
   const search=await mpGet(path);const payment=search?.results?.find((p:any)=>["approved","refunded","rejected","cancelled","pending","in_process"].includes(p.status));
   if(!payment)continue;
   const status=payment.status==="approved"?"paid":payment.status==="refunded"?"refunded":payment.status==="rejected"||payment.status==="cancelled"?"failed":"pending";
   const tx=String(payment.id);
   await db.from("directory_boost_orders").update({status,provider_transaction_id:tx,provider_reference:payment?.order?.id?String(payment.order.id):order.provider_reference,updated_at:new Date().toISOString()}).eq("id",order.id);
   if(status==="paid"){
      const starts=new Date(now.getTime()),ends=new Date(now.getTime()+Number(order.duration_days)*86400000).toISOString();
      await db.from("directory_boost_orders").update({starts_at:starts.toISOString(),ends_at:ends,updated_at:new Date().toISOString()}).eq("id",order.id);
      await db.from("business_directory").update({featured:true,featured_until:ends,updated_at:new Date().toISOString()}).eq("business_id",businessId);
      await db.from("platform_revenue").upsert({business_id:businessId,source:"directory_boost",source_reference:tx,gross_amount:Number(payment.transaction_amount||order.amount||0),platform_fee:0,currency:payment.currency_id||"COP",status:"paid"},{onConflict:"source,source_reference"});
   }
   boosts.push({order_id:order.id,status,provider_transaction_id:tx});
 }
 return json({ok:true,premium,boosts});
}catch(e){console.error("CITABOT_COMMERCIAL_SYNC_ERROR",e);return json({ok:false,error:e instanceof Error?e.message:"Error interno"},500)}});