import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), mp=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const publicUrl=Deno.env.get("CITABOT_PUBLIC_URL")||"https://servicerca.github.io/Citabot-/";
if(!url||!key) throw new Error("Supabase server configuration missing");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function user(req:Request){const h=req.headers.get("authorization")||"";const jwt=h.replace(/^Bearer\s+/i,"");if(!jwt)return null;const r=await db.auth.getUser(jwt);return r.data.user||null;}
type SubscriptionSnapshot = Record<string, unknown>;
type CancellationCheck = { confirmedCancelled: boolean; status: string | null; httpStatus: number | null };
function logCheckoutFailure(event: string, error: unknown) {
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate) ? candidate : "unknown";
  console.error(event, JSON.stringify({ code }));
}
function throwOnDbError(operation: string, error: { code?: unknown } | null | undefined) {
  if (!error) return;
  const candidate = error.code;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate) ? candidate : "unknown";
  console.error("CITABOT_CHECKOUT_DB_FAILED", JSON.stringify({ operation, code }));
  throw new Error("DATABASE_OPERATION_FAILED");
}
function isCancelled(status: string | null) {
  return status === "cancelled" || status === "canceled";
}
async function checkPreapproval(id: string): Promise<{ status: string | null; initPoint: string | null; httpStatus: number | null }> {
  try {
    const response = await fetch("https://api.mercadopago.com/preapproval/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + mp },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("CITABOT_CHECKOUT_PREAPPROVAL_LOOKUP_FAILED", JSON.stringify({ status: response.status }));
      return { status: null, initPoint: null, httpStatus: response.status };
    }
    return {
      status: typeof data?.status === "string" ? data.status : null,
      initPoint: typeof data?.init_point === "string" && data.init_point ? data.init_point : null,
      httpStatus: response.status,
    };
  } catch {
    console.error("CITABOT_CHECKOUT_PREAPPROVAL_LOOKUP_FAILED", JSON.stringify({ code: "network_error" }));
    return { status: null, initPoint: null, httpStatus: null };
  }
}
async function cancelAndVerifyPreapproval(id: string): Promise<CancellationCheck> {
  let putStatus: number | null = null;
  try {
    const response = await fetch("https://api.mercadopago.com/preapproval/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { Authorization: "Bearer " + mp, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "canceled" }),
    });
    putStatus = response.status;
    if (!response.ok) {
      console.error("CITABOT_CHECKOUT_CANCEL_REQUEST_FAILED", JSON.stringify({ status: response.status }));
    }
  } catch {
    console.error("CITABOT_CHECKOUT_CANCEL_REQUEST_FAILED", JSON.stringify({ code: "network_error" }));
  }
  const verified = await checkPreapproval(id);
  return {
    confirmedCancelled: isCancelled(verified.status),
    status: verified.status,
    httpStatus: putStatus ?? verified.httpStatus,
  };
}
async function setChangeReconciliation(id: string, values: {
  state: "in_progress" | "resolved" | "reconciliation_required";
  phase: "initiating" | "provider_created" | "local_pending_saved" | "old_subscription_cancelled" | "rollback_started" | "rolled_back" | "local_restore_failed" | "rollback_unconfirmed" | "finished";
  new_subscription_id?: string | null;
  error_code?: string | null;
}) {
  const payload: Record<string, unknown> = { ...values, updated_at: new Date().toISOString() };
  if (values.state === "resolved") payload.resolved_at = new Date().toISOString();
  const { data, error } = await db.from("subscription_change_reconciliation")
    .update(payload).eq("id", id).select("id").maybeSingle();
  throwOnDbError("reconciliation_update", error);
  if (!data?.id) throw new Error("RECONCILIATION_RECORD_MISSING");
}
async function restoreSubscriptionSnapshot(businessId: string, snapshot: SubscriptionSnapshot | null) {
  if (!snapshot) {
    const result = await db.from("subscriptions").delete().eq("business_id", businessId);
    throwOnDbError("restore_empty_subscription", result.error);
    return;
  }
  const prior = {
    plan: snapshot.plan,
    status: snapshot.status,
    trial_ends_at: snapshot.trial_ends_at ?? null,
    current_period_end: snapshot.current_period_end ?? null,
    provider: snapshot.provider ?? null,
    provider_customer_id: snapshot.provider_customer_id ?? null,
    provider_subscription_id: snapshot.provider_subscription_id ?? null,
    trial_started_at: snapshot.trial_started_at ?? null,
    updated_at: new Date().toISOString(),
  };
  const result = await db.from("subscriptions").update(prior)
    .eq("id", String(snapshot.id)).eq("business_id", businessId).select("id").maybeSingle();
  throwOnDbError("restore_subscription_snapshot", result.error);
  if (!result.data?.id) throw new Error("SUBSCRIPTION_SNAPSHOT_RESTORE_MISSING");
}
async function recordSubscriptionChange(businessId: string, previous: SubscriptionSnapshot | null) {
  const { data, error } = await db.from("subscription_change_reconciliation").insert({
    business_id: businessId,
    provider: "mercadopago",
    previous_plan: previous?.plan == null ? null : String(previous.plan),
    previous_subscription_id: previous?.provider_subscription_id == null ? null : String(previous.provider_subscription_id),
    new_plan: "premium",
    new_subscription_id: null,
    previous_subscription: previous,
    state: "in_progress",
    phase: "initiating",
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (error?.code === "23505") return null;
  throwOnDbError("reconciliation_insert", error);
  if (!data?.id) throw new Error("RECONCILIATION_INSERT_MISSING");
  return String(data.id);
}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);try{
 if(!mp)return json({ok:false,error:"Mercado Pago no está configurado."},503);
 const u=await user(req);if(!u)return json({ok:false,error:"Sesión inválida."},401);
 const b=await req.json();const businessId=String(b.business_id||"").trim();const mode=String(b.mode||"").trim();
 if(!businessId||!mode)return json({ok:false,error:"Datos incompletos."},400);
 const m=await db.from("business_members").select("role").eq("business_id",businessId).eq("user_id",u.id).maybeSingle();
 if(m.error)throw m.error;if(!m.data||!["owner","admin"].includes(m.data.role))return json({ok:false,error:"No autorizado."},403);
 const email=String(b.payer_email||u.email||"").trim();if(!email.includes("@"))return json({ok:false,error:"Correo inválido."},400);
 if(mode==="premium"){
   const unresolved=await db.from("subscription_change_reconciliation")
     .select("id,phase,state")
     .eq("business_id",businessId)
     .in("state",["in_progress","reconciliation_required"])
     .order("created_at",{ascending:false})
     .limit(1)
     .maybeSingle();
   throwOnDbError("unresolved_reconciliation_lookup",unresolved.error);
   if(unresolved.data?.id){
     return json({
       ok:false,
       error:"Hay un cambio de suscripción pendiente de conciliación. No inicies otro cambio ni completes un nuevo pago hasta que se revise.",
       reconciliation_reference:unresolved.data.id
     },409);
   }

   const existing=await db.from("subscriptions").select("*").eq("business_id",businessId).maybeSingle();
   throwOnDbError("existing_subscription_lookup",existing.error);
   const prior=(existing.data||null) as SubscriptionSnapshot|null;

   if(prior?.provider_subscription_id&&prior.plan==="premium"&&["active","pending"].includes(String(prior.status||""))){
     const remote=await checkPreapproval(String(prior.provider_subscription_id));
     if(remote.status==="authorized"){
       if(prior.status!=="active"){
         const mark=await db.from("subscriptions").update({
           status:"active",updated_at:new Date().toISOString()
         }).eq("id",String(prior.id));
         throwOnDbError("confirmed_premium_status_update",mark.error);
       }
       return json({ok:true,already_active:true,plan:"premium"});
     }
     if(remote.status==="pending"&&remote.initPoint){
       if(prior.status!=="pending"){
         const mark=await db.from("subscriptions").update({
           status:"pending",updated_at:new Date().toISOString()
         }).eq("id",String(prior.id));
         throwOnDbError("pending_premium_status_update",mark.error);
       }
       return json({ok:true,already_pending:true,plan:"premium",subscription_id:prior.provider_subscription_id,init_point:remote.initPoint,amount:69900});
     }
     if(isCancelled(remote.status)){
       const mark=await db.from("subscriptions").update({
         status:"cancelled",updated_at:new Date().toISOString()
       }).eq("id",String(prior.id));
       throwOnDbError("stale_premium_status_update",mark.error);
       prior.status="cancelled";
     }else{
       return json({
         ok:false,
         error:"No pudimos confirmar el estado de la suscripción Premium existente. No se creó otra suscripción; vuelve a intentarlo más tarde.",
       },503);
     }
   }

   let reconciliationId: string | null;
   try {
     reconciliationId=await recordSubscriptionChange(businessId,prior);
   } catch(error) {
     logCheckoutFailure("CITABOT_CHECKOUT_RECONCILIATION_RESERVATION_FAILED",error);
     return json({ok:false,error:"No se pudo reservar el cambio de suscripción. No se creó una nueva suscripción."},503);
   }
   if(!reconciliationId){
     const pending=await db.from("subscription_change_reconciliation")
       .select("id").eq("business_id",businessId)
       .in("state",["in_progress","reconciliation_required"])
       .order("created_at",{ascending:false}).limit(1).maybeSingle();
     throwOnDbError("concurrent_reconciliation_lookup",pending.error);
     if(pending.data?.id){
       return json({
         ok:false,
         error:"Ya existe un cambio de suscripción en curso. No se creó una segunda suscripción.",
         reconciliation_reference:pending.data.id
       },409);
     }
     return json({ok:false,error:"No se pudo reservar el cambio de suscripción. No se creó una nueva suscripción."},503);
   }

   let createResponse: Response;
   try {
     createResponse=await fetch("https://api.mercadopago.com/preapproval",{
     method:"POST",
     headers:{Authorization:"Bearer "+mp,"Content-Type":"application/json"},
     body:JSON.stringify({
       reason:"CitaBot Premium",
       external_reference:"citabot:"+businessId,
       payer_email:email,
       auto_recurring:{frequency:1,frequency_type:"months",transaction_amount:69900,currency_id:"COP"},
       back_url:publicUrl,
       status:"pending"
     })
   });
   } catch {
     await setChangeReconciliation(reconciliationId,{state:"reconciliation_required",phase:"rollback_unconfirmed",error_code:"PROVIDER_CREATE_STATE_UNKNOWN"});
     return json({
       ok:false,
       error:"No se pudo confirmar si Mercado Pago recibió la solicitud. No intentes otro cambio hasta revisar esta referencia.",
       reconciliation_required:true,
       reconciliation_reference:reconciliationId
     },503);
   }
   const d=await createResponse.json().catch(()=>({}));
   if(!createResponse.ok){
     console.error("CITABOT_PREMIUM_CREATE_FAILED",JSON.stringify({status:createResponse.status}));
     await setChangeReconciliation(reconciliationId,{state:"resolved",phase:"finished",error_code:"PROVIDER_CREATE_REJECTED"});
     return json({ok:false,error:"Mercado Pago no pudo crear la solicitud Premium. El plan actual no se modificó."},502);
   }
   const newProviderId=d?.id==null?"":String(d.id);
   if(!newProviderId){
     await setChangeReconciliation(reconciliationId,{state:"reconciliation_required",phase:"rollback_unconfirmed",error_code:"PROVIDER_ID_MISSING"});
     return json({
       ok:false,
       error:"Mercado Pago no devolvió el identificador de la solicitud. No completes ningún pago ni inicies otro cambio.",
       reconciliation_required:true,
       reconciliation_reference:reconciliationId
     },503);
   }
   await setChangeReconciliation(reconciliationId,{
     state:"in_progress",phase:"provider_created",new_subscription_id:newProviderId,error_code:null
   });

   const remoteInitPoint=typeof d?.init_point==="string"&&d.init_point?d.init_point:null;
   if(!remoteInitPoint){
     const rollback=await cancelAndVerifyPreapproval(newProviderId);
     if(rollback.confirmedCancelled){
       await setChangeReconciliation(reconciliationId,{state:"resolved",phase:"rolled_back",error_code:"INIT_POINT_MISSING"});
       return json({ok:false,error:"Mercado Pago no devolvió el enlace de pago. La nueva solicitud fue cancelada y el plan anterior no se modificó."},502);
     }
     await setChangeReconciliation(reconciliationId,{state:"reconciliation_required",phase:"rollback_unconfirmed",error_code:"INIT_POINT_MISSING_ROLLBACK_UNCONFIRMED"});
     return json({
       ok:false,
       error:"Mercado Pago no devolvió el enlace y no pudimos confirmar la cancelación. No completes ese pago ni inicies otro cambio.",
       reconciliation_required:true,
       reconciliation_reference:reconciliationId
     },503);
   }

   const oldProviderId=prior?.provider_subscription_id?String(prior.provider_subscription_id):null;
   const oldPlan=String(prior?.plan||"");
   const mustCancelOld=Boolean(oldProviderId&&oldPlan==="professional"&&["active","pending"].includes(String(prior?.status||"")));
   const row={
     business_id:businessId,
     plan:"premium",
     status:"pending",
     provider:"mercadopago",
     provider_customer_id:d?.payer_id?String(d.payer_id):null,
     provider_subscription_id:newProviderId,
     current_period_end:d?.next_payment_date||null,
     updated_at:new Date().toISOString()
   };

   try{
     if(prior){
       const write=await db.from("subscriptions").update(row).eq("id",String(prior.id)).select("id").maybeSingle();
       throwOnDbError("save_premium_pending",write.error);
       if(!write.data?.id)throw new Error("PREMIUM_PENDING_SAVE_MISSING");
     }else{
       const write=await db.from("subscriptions").insert(row).select("id").single();
       throwOnDbError("save_premium_pending",write.error);
       if(!write.data?.id)throw new Error("PREMIUM_PENDING_SAVE_MISSING");
     }
     await setChangeReconciliation(reconciliationId,{state:"in_progress",phase:"local_pending_saved",error_code:null});
   }catch(error){
     logCheckoutFailure("CITABOT_PREMIUM_LOCAL_SAVE_FAILED",error);
     let snapshotRestored=false;
     try{await restoreSubscriptionSnapshot(businessId,prior);snapshotRestored=true;}catch(restoreError){logCheckoutFailure("CITABOT_PREMIUM_SNAPSHOT_RESTORE_FAILED",restoreError);}
     const rollback=await cancelAndVerifyPreapproval(newProviderId);
     if(snapshotRestored&&rollback.confirmedCancelled){
       await setChangeReconciliation(reconciliationId,{state:"resolved",phase:"rolled_back",error_code:"LOCAL_SAVE_FAILED"});
       return json({ok:false,error:"No se pudo guardar el cambio de plan. La nueva solicitud fue cancelada y se conservó el estado local anterior."},503);
     }
     await setChangeReconciliation(reconciliationId,{
       state:"reconciliation_required",
       phase:snapshotRestored?"rollback_unconfirmed":"local_restore_failed",
       error_code:snapshotRestored?"LOCAL_SAVE_ROLLBACK_UNCONFIRMED":"LOCAL_RESTORE_FAILED"
     });
     return json({
       ok:false,
       error:"No se pudo confirmar la reversión del cambio de plan. No completes el pago ni inicies otro cambio.",
       reconciliation_required:true,
       reconciliation_reference:reconciliationId
     },503);
   }

   if(mustCancelOld){
     const oldCancellation=await cancelAndVerifyPreapproval(oldProviderId!);
     if(!oldCancellation.confirmedCancelled){
       if(isCancelled(oldCancellation.status)){
         // The provider confirms cancellation despite the original PUT result; continue safely.
         await setChangeReconciliation(reconciliationId,{state:"in_progress",phase:"old_subscription_cancelled",error_code:null});
       }else if(oldCancellation.status){
         // Provider confirms the old plan is still not cancelled. Roll back the new attempt.
         await setChangeReconciliation(reconciliationId,{state:"in_progress",phase:"rollback_started",error_code:"OLD_SUBSCRIPTION_CANCEL_FAILED"});
         let snapshotRestored=false;
         try{await restoreSubscriptionSnapshot(businessId,prior);snapshotRestored=true;}catch(restoreError){logCheckoutFailure("CITABOT_OLD_SNAPSHOT_RESTORE_FAILED",restoreError);}
         const rollback=await cancelAndVerifyPreapproval(newProviderId);
         if(snapshotRestored&&rollback.confirmedCancelled){
           await setChangeReconciliation(reconciliationId,{state:"resolved",phase:"rolled_back",error_code:"OLD_SUBSCRIPTION_CANCEL_FAILED"});
           return json({ok:false,error:"No se pudo confirmar la cancelación del plan Profesional. La nueva solicitud Premium sí quedó cancelada y se restauró el estado anterior."},502);
         }
         await setChangeReconciliation(reconciliationId,{
           state:"reconciliation_required",
           phase:snapshotRestored?"rollback_unconfirmed":"local_restore_failed",
           error_code:snapshotRestored?"NEW_SUBSCRIPTION_ROLLBACK_UNCONFIRMED":"LOCAL_RESTORE_FAILED"
         });
         return json({
           ok:false,
           error:"No se pudo confirmar la reversión del cambio entre planes. No completes ningún pago ni intentes otro cambio.",
           reconciliation_required:true,
           reconciliation_reference:reconciliationId
         },503);
       }else{
         // The old provider state is unknown; do not assume the prior plan survived.
         await setChangeReconciliation(reconciliationId,{state:"reconciliation_required",phase:"rollback_unconfirmed",error_code:"OLD_SUBSCRIPTION_STATE_UNKNOWN"});
         return json({
           ok:false,
           error:"Mercado Pago no permitió confirmar el estado del plan anterior. El cambio quedó detenido para revisión; no completes el pago ni inicies otro cambio.",
           reconciliation_required:true,
           reconciliation_reference:reconciliationId
         },503);
       }
     }else{
       await setChangeReconciliation(reconciliationId,{state:"in_progress",phase:"old_subscription_cancelled",error_code:null});
     }
   }

   await setChangeReconciliation(reconciliationId,{state:"resolved",phase:"finished",error_code:null});
   return json({ok:true,plan:"premium",subscription_id:newProviderId,init_point:remoteInitPoint,amount:69900});
 }
 if(mode==="boost"){
   const days=Number(b.duration_days);const prices:{[k:string]:number}={7:9900,15:19900,30:34900};if(!prices[days])return json({ok:false,error:"Duración no válida."},400);
   const title="CitaBot · Visibilidad destacada ("+days+" días)";
   const pending=await db.from("directory_boost_orders").select("id").eq("business_id",businessId).eq("status","pending").order("created_at",{ascending:false}).limit(1).maybeSingle();if(pending.error)throw pending.error;
   if(pending.data?.id)return json({ok:false,error:"Ya existe una compra de visibilidad pendiente para este negocio.",pending_order_id:pending.data.id},409);
   const o=await db.from("directory_boost_orders").insert({business_id:businessId,placement:"featured",duration_days:days,amount:prices[days],currency:"COP",status:"pending",provider:"mercadopago"}).select("id").single();if(o.error)throw o.error;
   const ref="citabot-boost:"+o.data.id;
   const pref=await fetch("https://api.mercadopago.com/checkout/preferences",{method:"POST",headers:{Authorization:"Bearer "+mp,"Content-Type":"application/json"},body:JSON.stringify({external_reference:ref,items:[{id:"citabot-directory-boost",title,quantity:1,unit_price:prices[days],currency_id:"COP"}],payer:{email},back_urls:{success:publicUrl,failure:publicUrl,pending:publicUrl},auto_return:"approved"})});
   const pd=await pref.json().catch(()=>({}));if(!pref.ok){await db.from("directory_boost_orders").delete().eq("id",o.data.id);return json({ok:false,error:pd?.message||"No se pudo crear el pago."},502);}
   await db.from("directory_boost_orders").update({provider_reference:String(pd.id||"")}).eq("id",o.data.id);
   return json({ok:true,mode:"boost",order_id:o.data.id,preference_id:pd.id,init_point:pd.init_point,amount:prices[days],duration_days:days});
 }
 return json({ok:false,error:"Modo no soportado."},400);
}catch(e){logCheckoutFailure("CITABOT_COMMERCIAL_CHECKOUT_FAILED",e);return json({ok:false,error:"No se pudo completar la operación comercial. Inténtalo de nuevo más tarde."},500)}});