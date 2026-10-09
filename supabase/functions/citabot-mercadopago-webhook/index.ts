import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-signature,x-request-id","Access-Control-Allow-Methods":"POST, OPTIONS"};
const SUPABASE_URL=Deno.env.get("SUPABASE_URL");const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");const MP_TOKEN=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");const MP_SECRET=Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
if(!SUPABASE_URL||!SERVICE_ROLE_KEY)throw new Error("Supabase server configuration missing");
const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function logWebhookFailure(error:unknown){const candidate=error&&typeof error==="object"&&"code" in error?(error as {code?:unknown}).code:null;const code=typeof candidate==="string"&&/^[A-Z0-9_]{1,20}$/.test(candidate)?candidate:"unknown";console.error("CITABOT_MERCADOPAGO_WEBHOOK_ERROR",JSON.stringify({code}));}
function throwOnDbError(operation:string,error:{code?:unknown}|null|undefined){
  if(!error)return;
  const candidate=error.code;
  const code=typeof candidate==="string"&&/^[A-Z0-9_]{1,20}$/.test(candidate)?candidate:"unknown";
  console.error("CITABOT_MERCADOPAGO_DB_OPERATION_FAILED",JSON.stringify({operation,code}));
  throw new Error("DATABASE_OPERATION_FAILED");
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
function parseSig(value:string|null){const out:{ts?:string,v1?:string}={};for(const part of value?.split(",")||[]){const [k,v]=part.trim().split("=");if(k==='ts'||k==='v1')out[k]=v;}return out;}
async function verifySignature(req:Request,dataId:string){if(!MP_SECRET)return false;const sig=parseSig(req.headers.get('x-signature'));const requestId=req.headers.get('x-request-id')||'';if(!sig.ts||!sig.v1)return false;const manifest=`id:${dataId};request-id:${requestId};ts:${sig.ts};`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(MP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(manifest));const hex=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');if(hex.length!==sig.v1.length)return false;let diff=0;for(let i=0;i<hex.length;i++)diff|=hex.charCodeAt(i)^sig.v1.charCodeAt(i);return diff===0;}
async function mpGet(path:string){if(!MP_TOKEN)throw new Error('Mercado Pago no está configurado.');const r=await fetch(`https://api.mercadopago.com${path}`,{headers:{Authorization:`Bearer ${MP_TOKEN}`}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`Mercado Pago ${r.status}`);return data;}
function mapSubStatus(status:string){if(status==='authorized')return 'active';if(status==='paused')return 'paused';if(status==='cancelled'||status==='canceled')return 'cancelled';if(status==='pending')return 'pending';return 'past_due';}
async function syncSubscription(id:string){const sub=await mpGet(`/preapproval/${encodeURIComponent(id)}`);const {data:local,error}=await db.from('subscriptions').select('id,business_id').eq('provider','mercadopago').eq('provider_subscription_id',String(id)).maybeSingle();if(error)throw error;if(!local?.business_id)return {ignored:true};const updates={status:mapSubStatus(String(sub.status||'pending')),provider_customer_id:sub?.payer_id?String(sub.payer_id):null,current_period_end:sub?.next_payment_date||sub?.auto_recurring?.end_date||null,updated_at:new Date().toISOString()};const {error:ue}=await db.from('subscriptions').update(updates).eq('id',local.id);if(ue)throw ue;return {business_id:local.business_id,status:updates.status};}
async function syncAuthorizedPayment(id:string){
  const invoice=await mpGet("/authorized_payments/"+encodeURIComponent(id));
  const preapproval=String(invoice?.preapproval_id||"");
  if(!preapproval)return {ignored:true};

  const {data:sub,error:subscriptionLookupError}=await db.from("subscriptions")
    .select("id,business_id,plan")
    .eq("provider","mercadopago")
    .eq("provider_subscription_id",preapproval)
    .maybeSingle();
  throwOnDbError("authorized_payment_subscription_lookup",subscriptionLookupError);
  if(!sub?.business_id)return {ignored:true};

  const paymentId=invoice?.payment?.id?String(invoice.payment.id):null;
  const providerStatus=String(invoice?.payment?.status||"");
  const status=providerStatus==="approved"?"paid":providerStatus==="rejected"?"failed":"pending";
  if(providerStatus==="approved"&&!paymentId)throw new Error("AUTHORIZED_PAYMENT_ID_MISSING");

  const amount=Number(invoice?.transaction_amount??0);
  if(!Number.isFinite(amount)||amount<0)throw new Error("AUTHORIZED_PAYMENT_AMOUNT_INVALID");
  const currency=String(invoice?.currency_id||"COP");

  if(paymentId){
    const concept=sub.plan==="premium"?"Suscripción CitaBot Premium":"Suscripción CitaBot Profesional";
    const paymentWrite=await db.from("payments").upsert({
      business_id:sub.business_id,
      amount,
      currency,
      method:"mercadopago",
      concept,
      status,
      provider:"mercadopago",
      provider_reference:preapproval,
      provider_transaction_id:paymentId
    },{onConflict:"provider,provider_transaction_id"});
    throwOnDbError("authorized_payment_ledger",paymentWrite.error);

    const revenueWrite=await db.from("platform_revenue").upsert({
      business_id:sub.business_id,
      source:"subscription",
      source_reference:paymentId,
      gross_amount:amount,
      platform_fee:0,
      currency,
      status
    },{onConflict:"source,source_reference"});
    throwOnDbError("authorized_payment_revenue",revenueWrite.error);
  }

  if(status==="paid"){
    const activation=await db.from("subscriptions")
      .update({status:"active",updated_at:new Date().toISOString()})
      .eq("id",sub.id);
    throwOnDbError("authorized_payment_subscription_activation",activation.error);
  }
  return {business_id:sub.business_id,status,plan:sub.plan};
}
async function syncPayment(id:string){
  const payment=await mpGet("/v1/payments/"+encodeURIComponent(id));
  const transactionId=payment?.id==null?"":String(payment.id);
  if(!transactionId||transactionId!==id)throw new Error("PAYMENT_ID_MISMATCH");

  const ref=String(payment?.external_reference||"");
  const status=payment?.status==="approved"?"paid":payment?.status==="refunded"?"refunded":payment?.status==="rejected"||payment?.status==="cancelled"?"failed":"pending";
  const amount=Number(payment?.transaction_amount??0);
  if(!Number.isFinite(amount)||amount<0)throw new Error("PAYMENT_AMOUNT_INVALID");
  const currency=String(payment?.currency_id||"COP");

  if(ref.startsWith("citabot-boost:")){
    const orderId=ref.slice("citabot-boost:".length);
    const {data:order,error:orderLookupError}=await db.from("directory_boost_orders")
      .select("id,business_id,duration_days,amount,status,starts_at,ends_at")
      .eq("id",orderId)
      .maybeSingle();
    throwOnDbError("boost_order_lookup",orderLookupError);
    if(!order?.business_id)return {ignored:true};

    const providerReference=payment?.order?.id?String(payment.order.id):null;
    const baseUpdate={
      provider:"mercadopago",
      provider_reference:providerReference,
      provider_transaction_id:transactionId,
      updated_at:new Date().toISOString()
    };

    if(status==="paid"){
      const startAt=order.starts_at?new Date(order.starts_at):new Date();
      const endAt=order.ends_at?new Date(order.ends_at):new Date(startAt.getTime()+Number(order.duration_days)*86400000);
      if(Number.isNaN(startAt.getTime())||Number.isNaN(endAt.getTime())||endAt<=startAt)throw new Error("BOOST_ORDER_DATES_INVALID");

      // Keep the order pending/paid until all entitlement and revenue writes succeed.
      // This makes provider retries recover partial writes without extending the boost.
      const dateWrite=await db.from("directory_boost_orders").update({
        ...baseUpdate,
        starts_at:startAt.toISOString(),
        ends_at:endAt.toISOString()
      }).eq("id",order.id).select("id").maybeSingle();
      throwOnDbError("boost_order_dates",dateWrite.error);
      if(!dateWrite.data?.id)throw new Error("BOOST_ORDER_DATES_MISSING");

      const listing=await db.from("business_directory").update({
        featured:endAt.getTime()>Date.now(),
        featured_until:endAt.toISOString(),
        updated_at:new Date().toISOString()
      }).eq("business_id",order.business_id).select("business_id").maybeSingle();
      throwOnDbError("boost_directory_activation",listing.error);
      if(!listing.data?.business_id)throw new Error("BOOST_DIRECTORY_LISTING_MISSING");

      const revenueWrite=await db.from("platform_revenue").upsert({
        business_id:order.business_id,
        source:"directory_boost",
        source_reference:transactionId,
        gross_amount:amount||Number(order.amount||0),
        platform_fee:0,
        currency,
        status:"paid"
      },{onConflict:"source,source_reference"});
      throwOnDbError("boost_revenue",revenueWrite.error);

      const finalOrderWrite=await db.from("directory_boost_orders").update({
        ...baseUpdate,
        status:"paid",
        updated_at:new Date().toISOString()
      }).eq("id",order.id).select("id").maybeSingle();
      throwOnDbError("boost_order_paid_status",finalOrderWrite.error);
      if(!finalOrderWrite.data?.id)throw new Error("BOOST_ORDER_PAID_STATUS_MISSING");
    }else if(status==="refunded"){
      const revenueWrite=await db.from("platform_revenue").upsert({
        business_id:order.business_id,
        source:"directory_boost",
        source_reference:transactionId,
        gross_amount:amount||Number(order.amount||0),
        platform_fee:0,
        currency,
        status:"refunded"
      },{onConflict:"source,source_reference"});
      throwOnDbError("boost_refund_revenue",revenueWrite.error);

      // Revoke only the entitlement granted by this order. If another later boost
      // has changed featured_until, leave that newer promotion intact.
      if(order.ends_at){
        const revoke=await db.from("business_directory").update({
          featured:false,
          featured_until:null,
          updated_at:new Date().toISOString()
        }).eq("business_id",order.business_id)
          .eq("featured_until",order.ends_at)
          .select("business_id").maybeSingle();
        throwOnDbError("boost_refund_revoke",revoke.error);
      }

      const finalOrderWrite=await db.from("directory_boost_orders").update({
        ...baseUpdate,
        status:"refunded",
        updated_at:new Date().toISOString()
      }).eq("id",order.id).select("id").maybeSingle();
      throwOnDbError("boost_refund_status",finalOrderWrite.error);
      if(!finalOrderWrite.data?.id)throw new Error("BOOST_REFUND_STATUS_MISSING");
    }else{
      const finalOrderWrite=await db.from("directory_boost_orders").update({
        ...baseUpdate,
        status,
        updated_at:new Date().toISOString()
      }).eq("id",order.id).select("id").maybeSingle();
      throwOnDbError("boost_order_status_update",finalOrderWrite.error);
      if(!finalOrderWrite.data?.id)throw new Error("BOOST_ORDER_STATUS_UPDATE_MISSING");
    }
    return {business_id:order.business_id,status,boost_order_id:order.id};
  }

  const businessId=ref.startsWith("citabot:")?ref.slice("citabot:".length):"";
  if(!businessId)return {ignored:true};

  const {data:sub,error:subscriptionLookupError}=await db.from("subscriptions")
    .select("plan")
    .eq("business_id",businessId)
    .maybeSingle();
  throwOnDbError("payment_subscription_lookup",subscriptionLookupError);
  const concept=sub?.plan==="premium"?"Suscripción CitaBot Premium":"Suscripción CitaBot Profesional";

  const paymentWrite=await db.from("payments").upsert({
    business_id:businessId,
    amount,
    currency,
    method:"mercadopago",
    concept,
    status,
    provider:"mercadopago",
    provider_reference:payment?.order?.id?String(payment.order.id):null,
    provider_transaction_id:transactionId
  },{onConflict:"provider,provider_transaction_id"});
  throwOnDbError("payment_ledger",paymentWrite.error);

  const revenueWrite=await db.from("platform_revenue").upsert({
    business_id:businessId,
    source:"subscription",
    source_reference:transactionId,
    gross_amount:amount,
    platform_fee:0,
    currency,
    status
  },{onConflict:"source,source_reference"});
  throwOnDbError("payment_revenue",revenueWrite.error);

  if(status==="paid"){
    const activation=await db.from("subscriptions")
      .update({status:"active",updated_at:new Date().toISOString()})
      .eq("business_id",businessId);
    throwOnDbError("payment_subscription_activation",activation.error);
  }
  return {business_id:businessId,status};
}
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({ok:false,error:'Método no permitido'},405);try{const body=await req.json();const type=String(body?.type||body?.topic||'');const dataId=String(body?.data?.id||body?.id||'');if(!dataId)return json({ok:true,ignored:true});if(!MP_SECRET)return json({ok:false,error:'Webhook secret no configurado'},503);if(!(await verifySignature(req,dataId)))return json({ok:false,error:'Firma inválida'},401);let result={ignored:true};if(type==='subscription_preapproval')result=await syncSubscription(dataId);else if(type==='subscription_authorized_payment')result=await syncAuthorizedPayment(dataId);else if(type==='payment')result=await syncPayment(dataId);return json({ok:true,result});}catch(e){logWebhookFailure(e);return json({ok:false,error:'No se pudo procesar el evento de pago. Inténtalo de nuevo más tarde.'},500)}});