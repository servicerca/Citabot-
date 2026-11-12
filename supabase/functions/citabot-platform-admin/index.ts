import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAllPages } from "./pagination.ts";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const ADMIN_BUSINESS_LIST_LIMIT=500;

const admin=createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function authUser(req:Request){
  const h=req.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer ")) throw new Error("unauthorized");
  const {data,error}=await admin.auth.getUser(h.slice(7));
  if(error||!data.user) throw new Error("unauthorized");
  return data.user;
}

function sumAmounts(rows:any[]|null|undefined, field:string){
  return (rows||[]).reduce((sum,row)=>{
    const n=Number(row?.[field]);
    return Number.isFinite(n)?sum+n:sum;
  },0);
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return Response.json({ok:false,error:"method_not_allowed"},{status:405,headers:cors});

  try{
    const user=await authUser(req);

    const {data:adminRow,error:adminError}=await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id",user.id)
      .eq("is_active",true)
      .maybeSingle();

    if(adminError) throw adminError;
    if(!adminRow) return Response.json({ok:false,error:"forbidden"},{status:403,headers:cors});

    const requestBody=await req.json().catch(()=>({}));
    if(requestBody?.action==="enroll_30_day_pilot"){
      const businessId=typeof requestBody.business_id==="string"?requestBody.business_id.trim():"";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)){
        return Response.json({ok:false,error:"Selecciona un negocio válido."},{status:400,headers:cors});
      }
      const {data,error}=await admin.rpc("citabot_enroll_30_day_pilot",{
        p_business_id:businessId,
        p_enrolled_by:user.id
      });
      if(error){
        const raw=String(error.message||"");
        const pilotErrors:Record<string,string>={
          PILOT_ADMIN_REQUIRED:"Tu cuenta no tiene permiso para asignar cupos del piloto.",
          PILOT_BUSINESS_NOT_FOUND_OR_INACTIVE:"El negocio no existe o está inactivo.",
          PILOT_SUBSCRIPTION_NOT_ELIGIBLE:"El negocio tiene un plan de pago o un estado que no permite esta invitación.",
          PILOT_SLOTS_FULL:"Los cinco cupos del piloto ya fueron asignados.",
          PILOT_INVALID_INPUT:"La solicitud de invitación no es válida."
        };
        const code=Object.keys(pilotErrors).find(key=>raw.includes(key));
        return Response.json(
          {ok:false,error:code?pilotErrors[code]:"No fue posible asignar el cupo del piloto."},
          {status:code==="PILOT_ADMIN_REQUIRED"?403:code?409:500,headers:cors}
        );
      }
      return Response.json({ok:true,action:"pilot_enrolled",enrollment:data},{status:200,headers:cors});
    }

    // Keep the visible table bounded, but compute dashboard counts against the
    // complete tables so Supabase's response cap cannot make totals inaccurate.
    const [businessesResult,activeBusinessesResult,listedBusinessesResult,activeSubscriptionsResult]=await Promise.all([
      admin.from("businesses")
        .select("id,name,category,city,is_active,is_listed,created_at",{count:"exact"})
        .order("created_at",{ascending:false})
        .order("id",{ascending:true})
        .limit(ADMIN_BUSINESS_LIST_LIMIT),
      admin.from("businesses").select("id",{count:"exact",head:true}).eq("is_active",true),
      admin.from("businesses").select("id",{count:"exact",head:true}).eq("is_listed",true),
      admin.from("subscriptions").select("id",{count:"exact",head:true}).in("status",["active","trialing","pending"])
    ]);

    if(businessesResult.error) throw businessesResult.error;
    if(activeBusinessesResult.error) throw activeBusinessesResult.error;
    if(listedBusinessesResult.error) throw listedBusinessesResult.error;
    if(activeSubscriptionsResult.error) throw activeSubscriptionsResult.error;
    if(businessesResult.count===null||activeBusinessesResult.count===null||
       listedBusinessesResult.count===null||activeSubscriptionsResult.count===null){
      throw new Error("admin_summary_count_unavailable");
    }

    const businesses=businessesResult.data||[];
    const businessIds=businesses.map((b)=>b.id);
    const [subscriptionsRows,revenueRows,integrationsRows,boostRows,pilotEnrollmentsResult]=await Promise.all([
      businessIds.length
        ? fetchAllPages((from,to)=>admin.from("subscriptions")
            .select("id,business_id,plan,status,current_period_end")
            .in("business_id",businessIds)
            .order("business_id",{ascending:true})
            .order("id",{ascending:true})
            .range(from,to))
        : Promise.resolve([]),
      fetchAllPages((from,to)=>admin.from("platform_revenue")
        .select("id,business_id,gross_amount,status,currency,created_at")
        .eq("status","paid")
        .order("created_at",{ascending:false})
        .order("id",{ascending:true})
        .range(from,to)),
      businessIds.length
        ? fetchAllPages((from,to)=>admin.from("business_integrations")
            .select("id,business_id,provider,enabled")
            .in("business_id",businessIds)
            .order("business_id",{ascending:true})
            .order("provider",{ascending:true})
            .order("id",{ascending:true})
            .range(from,to))
        : Promise.resolve([]),
      fetchAllPages((from,to)=>admin.from("directory_boost_orders")
        .select("id,business_id,amount,status,created_at")
        .eq("status","pending")
        .order("created_at",{ascending:false})
        .order("id",{ascending:true})
        .range(from,to)),
      admin.from("citabot_pilot_enrollments")
        .select("id,slot,business_id,business_name_snapshot,owner_user_id,enrolled_by,started_at,ends_at,created_at")
        .order("slot",{ascending:true})
    ]);

    if(pilotEnrollmentsResult.error) throw pilotEnrollmentsResult.error;
    const pilotEnrollments=pilotEnrollmentsResult.data||[];
    const pilotByBusiness=new Map((pilotEnrollments||[])
      .filter((p:any)=>Boolean(p.business_id))
      .map((p:any)=>[p.business_id,p]));

    const subscriptionByBusiness=new Map((subscriptionsRows||[]).map((s:any)=>[s.business_id,s]));
    const integrationsByBusiness=new Map<string,string[]>();
    for(const row of integrationsRows||[]){
      if(!row.enabled) continue;
      const list=integrationsByBusiness.get(row.business_id)||[];
      list.push(String(row.provider||"integration"));
      integrationsByBusiness.set(row.business_id,list);
    }

    const mappedBusinesses=(businesses||[]).map((b)=>({
      id:b.id,
      name:b.name,
      category:b.category||"—",
      city:b.city||"—",
      is_active:Boolean(b.is_active),
      is_listed:Boolean(b.is_listed),
      created_at:b.created_at,
      subscription:subscriptionByBusiness.get(b.id)||null,
      enabled_integrations:integrationsByBusiness.get(b.id)||[],
      pilot_enrollment:pilotByBusiness.get(b.id)||null
    }));

    const paidRevenue=sumAmounts(revenueRows,"gross_amount");
    const pendingBoosts=sumAmounts(boostRows,"amount");

    return Response.json({
      ok:true,
      role:"platform_admin",
      summary:{
        businesses_total:businessesResult.count,
        businesses_active:activeBusinessesResult.count,
        businesses_listed:listedBusinessesResult.count,
        subscriptions_active:activeSubscriptionsResult.count,
        paid_revenue:paidRevenue,
        pending_boost_amount:pendingBoosts,
        paid_revenue_currency:"COP",
        pilot_slots_used:pilotEnrollments.length,
        pilot_slots_total:5,
        pilot_slots_remaining:Math.max(0,5-pilotEnrollments.length)
      },
      pilot_enrollments:pilotEnrollments,
      businesses:mappedBusinesses,
      businesses_display_limit:ADMIN_BUSINESS_LIST_LIMIT,
      businesses_truncated:businessesResult.count>mappedBusinesses.length
    },{status:200,headers:cors});
  }catch(e){
    const message=e instanceof Error?e.message:"request_failed";
    const status=message==="unauthorized"?401:500;
    return Response.json({ok:false,error:status===401?"unauthorized":"admin_panel_failed"},{status,headers:cors});
  }
});
