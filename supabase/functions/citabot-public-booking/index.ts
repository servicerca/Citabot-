import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL");const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!serviceKey)throw new Error("Supabase server configuration missing");
const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
async function rateKey(req:Request,slug:string){const raw=`${req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown"}|${slug}`;const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("")}
async function allowed(req:Request,slug:string,limit:number,windowSeconds:number){const key=await rateKey(req,slug);const {data,error}=await db.rpc("consume_public_booking_rate_limit",{p_rate_key:key,p_limit:limit,p_window_seconds:windowSeconds});if(error)throw error;return data===true}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(req.method==="GET"){
   const slug=new URL(req.url).searchParams.get("slug")?.trim().toLowerCase();
   if(!slug||!/^[a-z0-9-]{2,80}$/.test(slug))return json({ok:false,error:"Slug inválido"},400);
   if(!(await allowed(req,slug,60,300)))return json({ok:false,error:"Demasiadas solicitudes. Inténtalo de nuevo en unos minutos."},429);
   const {data,error}=await db.rpc("get_public_booking",{p_business_slug:slug});
   if(error)return json({ok:false,error:error.message},404);
   if(data&&Array.isArray(data.staff)&&data.staff.length===0)data.staff=[{id:"",name:"Sin profesional asignado"}];
   return json({ok:true,data});
  }
  if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);
  const body=await req.json();
  const slug=String(body?.business_slug??"").trim().toLowerCase();
  const serviceId=String(body?.service_id??"").trim();
  const staffRaw=body?.staff_id==null?"":String(body.staff_id).trim();
  const customerName=String(body?.customer_name??"").trim();
  const customerPhone=String(body?.customer_phone??"").trim();
  const customerEmail=body?.customer_email==null?"":String(body.customer_email).trim();
  const startsAt=String(body?.starts_at??"").trim();
  const customerNotes=body?.customer_notes==null?"":String(body.customer_notes).trim();
  const paymentMethod=String(body?.payment_method??"cash").trim().toLowerCase();
  const privacyConsent=body?.privacy_consent===true;
  const whatsappConsent=body?.whatsapp_consent===true;
  if(!/^[a-z0-9-]{2,80}$/.test(slug))return json({ok:false,error:"Negocio inválido"},400);
  if(!serviceId||!customerName||!customerPhone||!startsAt)return json({ok:false,error:"Faltan datos obligatorios"},400);
  if(!privacyConsent||!whatsappConsent)return json({ok:false,error:"Debes aceptar privacidad y el uso de WhatsApp para gestionar la reserva"},400);
  if(customerName.length>120||customerPhone.length>40||customerEmail.length>160||customerNotes.length>1000)return json({ok:false,error:"Datos demasiado largos"},400);
  if(!["cash","transfer","other"].includes(paymentMethod))return json({ok:false,error:"Forma de pago no válida"},400);
  if(!(await allowed(req,slug,10,300)))return json({ok:false,error:"Demasiadas reservas desde este origen. Inténtalo de nuevo más tarde."},429);
  const parsed=new Date(startsAt);
  if(Number.isNaN(parsed.getTime())||parsed.getTime()<=Date.now())return json({ok:false,error:"La fecha y hora deben ser futuras"},400);
  if(parsed.getTime()>Date.now()+365*24*60*60*1000)return json({ok:false,error:"La reserva no puede superar 365 días de anticipación"},400);
  const {data,error}=await db.rpc("book_appointment_v3",{
    p_business_slug:slug,p_service_id:serviceId,p_staff_id:staffRaw||null,p_customer_name:customerName,
    p_customer_phone:customerPhone,p_customer_email:customerEmail||null,p_starts_at:parsed.toISOString(),
    p_customer_notes:customerNotes||null,p_privacy_consent:privacyConsent,p_whatsapp_consent:whatsappConsent,
    p_payment_method:paymentMethod
  });
  if(error)return json({ok:false,error:error.message},400);
  return json({ok:true,appointment_id:data});
 }catch(error){return json({ok:false,error:error instanceof Error?error.message:"Error interno"},500)}
});