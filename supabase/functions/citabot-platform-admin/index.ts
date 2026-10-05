import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

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

    const {data:businesses,error:businessError}=await admin
      .from("businesses")
      .select("id,name,category,city,is_active,is_listed,created_at")
      .order("created_at",{ascending:false})
      .limit(500);
    if(businessError) throw businessError;

    const businessIds=(businesses||[]).map((b)=>b.id);
    const [subscriptionsResult,revenueResult,integrationsResult,boostResult]=await Promise.all([
      businessIds.length
        ? admin.from("subscriptions").select("business_id,plan,status,current_period_end").in("business_id",businessIds)
        : Promise.resolve({data:[],error:null}),
      admin.from("platform_revenue").select("business_id,gross_amount,status,currency,created_at").eq("status","paid").order("created_at",{ascending:false}).limit(2000),
      businessIds.length
        ? admin.from("business_integrations").select("business_id,provider,enabled").in("business_id",businessIds)
        : Promise.resolve({data:[],error:null}),
      admin.from("directory_boost_orders").select("business_id,amount,status").eq("status","pending").limit(1000)
    ]);

    if(subscriptionsResult.error) throw subscriptionsResult.error;
    if(revenueResult.error) throw revenueResult.error;
    if(integrationsResult.error) throw integrationsResult.error;
    if(boostResult.error) throw boostResult.error;

    const subscriptionByBusiness=new Map((subscriptionsResult.data||[]).map((s)=>[s.business_id,s]));
    const integrationsByBusiness=new Map<string,string[]>();
    for(const row of integrationsResult.data||[]){
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
      enabled_integrations:integrationsByBusiness.get(b.id)||[]
    }));

    const paidRevenue=sumAmounts(revenueResult.data,"gross_amount");
    const pendingBoosts=sumAmounts(boostResult.data,"amount");

    return Response.json({
      ok:true,
      role:"platform_admin",
      summary:{
        businesses_total:mappedBusinesses.length,
        businesses_active:mappedBusinesses.filter((b)=>b.is_active).length,
        businesses_listed:mappedBusinesses.filter((b)=>b.is_listed).length,
        subscriptions_active:(subscriptionsResult.data||[]).filter((s)=>["active","trialing","pending"].includes(s.status)).length,
        paid_revenue:paidRevenue,
        pending_boost_amount:pendingBoosts,
        paid_revenue_currency:"COP"
      },
      businesses:mappedBusinesses
    },{status:200,headers:cors});
  }catch(e){
    const message=e instanceof Error?e.message:"request_failed";
    const status=message==="unauthorized"?401:500;
    return Response.json({ok:false,error:status===401?"unauthorized":"admin_panel_failed"},{status,headers:cors});
  }
});
