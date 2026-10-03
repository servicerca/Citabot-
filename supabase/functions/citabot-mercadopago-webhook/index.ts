import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-signature,x-request-id","Access-Control-Allow-Methods":"POST, OPTIONS"};
const SUPABASE_URL=Deno.env.get("SUPABASE_URL");const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");const MP_TOKEN=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");const MP_SECRET=Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
if(!SUPABASE_URL||!SERVICE_ROLE_KEY)throw new Error("Supabase server configuration missing");
const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
function parseSig(value:string|null){const out:{ts?:string,v1?:string}={};for(const part of value?.split(",")||[]){const [k,v]=part.trim().split("=");if(k==='ts'||k==='v1')out[k]=v;}return out;}
async function verifySignature(req:Request,dataId:string){if(!MP_SECRET)return false;const sig=parseSig(req.headers.get('x-signature'));const requestId=req.headers.get('x-request-id')||'';if(!sig.ts||!sig.v1)return false;const manifest=`id:${dataId};request-id:${requestId};ts:${sig.ts};`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(MP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(manifest));const hex=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');if(hex.length!==sig.v1.length)return false;let diff=0;for(let i=0;i<hex.length;i++)diff|=hex.charCodeAt(i)^sig.v1.charCodeAt(i);return diff===0;}
async function mpGet(path:string){if(!MP_TOKEN)throw new Error('Mercado Pago no está configurado.');const r=await fetch(`https://api.mercadopago.com${path}`,{headers:{Authorization:`Bearer ${MP_TOKEN}`}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`Mercado Pago ${r.status}`);return data;}
function mapSubStatus(status:string){if(status==='authorized')return 'active';if(status==='paused')return 'paused';if(status==='cancelled'||status==='canceled')return 'cancelled';if(status==='pending')return 'pending';return 'past_due';}
async function syncSubscription(id:string){const sub=await mpGet(`/preapproval/${encodeURIComponent(id)}`);const {data:local,error}=await db.from('subscriptions').select('id,business_id').eq('provider','mercadopago').eq('provider_subscription_id',String(id)).maybeSingle();if(error)throw error;if(!local?.business_id)return {ignored:true};const updates={status:mapSubStatus(String(sub.status||'pending')),provider_customer_id:sub?.payer_id?String(sub.payer_id):null,current_period_end:sub?.next_payment_date||sub?.auto_recurring?.end_date||null,updated_at:new Date().toISOString()};const {error:ue}=await db.from('subscriptions').update(updates).eq('id',local.id);if(ue)throw ue;return {business_id:local.business_id,status:updates.status};}
async function syncAuthorizedPayment(id:string){
  const invoice=await mpGet(`/authorized_payments/${encodeURIComponent(id)}`);
  const preapproval=String(invoice?.preapproval_id||"");if(!preapproval)return {ignored:true};
  const {data:sub,error:se}=await db.from("subscriptions").select("id,business_id,plan").eq("provider","mercadopago").eq("provider_subscription_id",preapproval).maybeSingle();if(se)throw se;if(!sub?.business_id)return {ignored:true};
  const paymentId=invoice?.payment?.id?String(invoice.payment.id):null;
  const status=invoice?.payment?.status==="approved"?"paid":invoice?.payment?.status==="rejected"?"failed":"pending";
  const amount=Number(invoice?.transaction_amount||0);
  if(paymentId){
    const concept=sub.plan==="premium"?"Suscripción CitaBot Premium":"Suscripción CitaBot Profesional";
    const {error}=await db.from("payments").upsert({business_id:sub.business_id,amount,currency:invoice?.currency_id||"COP",method:"mercadopago",concept,status,provider:"mercadopago",provider_reference:preapproval,provider_transaction_id:paymentId},{onConflict:"provider,provider_transaction_id"});if(error)throw error;
    await db.from("platform_revenue").upsert({business_id:sub.business_id,source:"subscription",source_reference:paymentId||preapproval, gross_amount:amount,platform_fee:0,currency:invoice?.currency_id||"COP",status},{onConflict:"source,source_reference"});
  }
  if(status==="paid")await db.from("subscriptions").update({status:"active",updated_at:new Date().toISOString()}).eq("id",sub.id);
  return {business_id:sub.business_id,status,plan:sub.plan};
}
async function syncPayment(id:string){
  const payment=await mpGet(`/v1/payments/${encodeURIComponent(id)}`);
  const ref=String(payment?.external_reference||"");
  const status=payment?.status==="approved"?"paid":payment?.status==="refunded"?"refunded":payment?.status==="rejected"||payment?.status==="cancelled"?"failed":"pending";
  if(ref.startsWith("citabot-boost:")){
    const orderId=ref.slice("citabot-boost:".length);
    const {data:order,error:oe}=await db.from("directory_boost_orders").select("id,business_id,duration_days,amount").eq("id",orderId).maybeSingle();if(oe)throw oe;if(!order?.business_id)return {ignored:true};
    const tx=String(payment.id);
    await db.from("directory_boost_orders").update({status,provider:"mercadopago",provider_reference:payment?.order?.id?String(payment.order.id):null,provider_transaction_id:tx,updated_at:new Date().toISOString()}).eq("id",order.id);
    if(status==="paid"){
      const startAt=new Date(),endAt=new Date(startAt.getTime()+Number(order.duration_days)*86400000);
      await db.from("directory_boost_orders").update({starts_at:startAt.toISOString(),ends_at:endAt.toISOString(),updated_at:new Date().toISOString()}).eq("id",order.id);await db.from("business_directory").update({featured:true,featured_until:endAt.toISOString(),updated_at:new Date().toISOString()}).eq("business_id",order.business_id);
      await db.from("platform_revenue").upsert({business_id:order.business_id,source:"directory_boost",source_reference:tx,gross_amount:Number(payment?.transaction_amount||order.amount||0),platform_fee:0,currency:payment?.currency_id||"COP",status:"paid"},{onConflict:"source,source_reference"});
    }
    return {business_id:order.business_id,status,boost_order_id:order.id};
  }
  const businessId=ref.startsWith("citabot:")?ref.slice(8):"";
  if(!businessId)return {ignored:true};
  const {data:sub}=await db.from("subscriptions").select("plan").eq("business_id",businessId).maybeSingle();
  const concept=sub?.plan==="premium"?"Suscripción CitaBot Premium":"Suscripción CitaBot Profesional";
  const tx=String(payment.id);
  const {error}=await db.from("payments").upsert({business_id:businessId,amount:Number(payment?.transaction_amount||0),currency:payment?.currency_id||"COP",method:"mercadopago",concept,status,provider:"mercadopago",provider_reference:payment?.order?.id?String(payment.order.id):null,provider_transaction_id:tx},{onConflict:"provider,provider_transaction_id"});if(error)throw error;
  await db.from("platform_revenue").upsert({business_id:businessId,source:"subscription",source_reference:tx, gross_amount:Number(payment?.transaction_amount||0),platform_fee:0,currency:payment?.currency_id||"COP",status},{onConflict:"source,source_reference"});
  if(status==="paid")await db.from("subscriptions").update({status:"active",updated_at:new Date().toISOString()}).eq("business_id",businessId);
  return {business_id:businessId,status};
}
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({ok:false,error:'Método no permitido'},405);try{const body=await req.json();const type=String(body?.type||body?.topic||'');const dataId=String(body?.data?.id||body?.id||'');if(!dataId)return json({ok:true,ignored:true});if(!MP_SECRET)return json({ok:false,error:'Webhook secret no configurado'},503);if(!(await verifySignature(req,dataId)))return json({ok:false,error:'Firma inválida'},401);let result={ignored:true};if(type==='subscription_preapproval')result=await syncSubscription(dataId);else if(type==='subscription_authorized_payment')result=await syncAuthorizedPayment(dataId);else if(type==='payment')result=await syncPayment(dataId);return json({ok:true,result});}catch(e){console.error('CITABOT_MERCADOPAGO_WEBHOOK_ERROR',e);return json({ok:false,error:e instanceof Error?e.message:'Error interno'},500)}});