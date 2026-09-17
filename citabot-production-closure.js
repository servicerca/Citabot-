// CitaBot production closure: real-data UI + safe appointment booking.
(() => {
  'use strict';
  const SUPABASE_URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XjqZnyBiOxC1fLNE9rJxQw_9xzEXquH';
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!client) return;
  const $ = id => document.getElementById(id);
  const toast = m => window.showToast ? window.showToast(m) : console.log(m);
  const esc = s => String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
  const money = n => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO') + ' COP';

  async function getBusiness() {
    const { data: { user }, error: ue } = await client.auth.getUser();
    if (ue) throw ue;
    if (!user) throw new Error('Primero inicia sesión.');
    const { data: members, error: me } = await client.from('business_members').select('business_id,role').eq('user_id', user.id);
    if (me) throw me;
    if (!members?.length) throw new Error('No hay un negocio asociado a esta cuenta.');
    const ids = members.map(x => x.business_id);
    const { data: businesses, error: be } = await client.from('businesses').select('*').in('id', ids).eq('is_active', true).limit(1);
    if (be) throw be;
    if (!businesses?.[0]) throw new Error('No hay un negocio activo.');
    return businesses[0];
  }

  window.sendMessage = async () => {
    try {
      await getBusiness();
      const composer = document.querySelector('#view-conversations .composer');
      const input = composer?.querySelector('input,textarea');
      const body = input?.value?.trim();
      const selected = document.querySelector('#view-conversations .chat-item.selected');
      const customerId = selected?.dataset?.customer;
      if (!body) throw new Error('Escribe un mensaje.');
      if (!customerId) throw new Error('Selecciona un cliente.');
      const { data: result, error } = await client.functions.invoke('citabot-whatsapp-send', { body: { customer_id: customerId, body } });
      if (error) throw error;
      if (!result?.ok) throw new Error(result?.error || 'WhatsApp no confirmó el envío.');
      if (input) input.value = '';
      toast('Mensaje enviado por WhatsApp.');
      if (typeof window.loadCitaBotData === 'function') await window.loadCitaBotData();
    } catch (e) {
      console.error('CITABOT_WHATSAPP_SEND_ERROR', e);
      toast(e?.message || 'No se pudo enviar el mensaje.');
    }
  };

  function removeFakeSurface() {
    document.querySelectorAll('.demo-hero').forEach(e => e.remove());
    document.querySelectorAll('button').forEach(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'ver demo') b.remove();
      if (t.includes('salir de demo')) b.textContent = 'Cerrar sesión';
    });
    document.querySelectorAll('.card').forEach(c => {
      const t = (c.textContent || '').toLowerCase();
      if (t.includes('estado del mvp') || t.includes('modo demo')) c.remove();
    });
    document.title = 'CitaBot — Plataforma para negocios';
    const preview = document.querySelector('#landing .hero-preview');
    if (preview) {
      preview.innerHTML = '<div class="preview-inner"><div class="ai-head"><div class="ai-icon">C</div><div><b>CitaBot</b><small style="display:block;color:var(--muted)">Datos reales al iniciar sesión</small></div></div><p style="font-size:12px;color:var(--muted);margin:18px 0 4px">Tu panel se alimenta de clientes, citas, pagos y conversaciones reales de tu negocio.</p></div>';
      preview.style.transform = 'none';
    }
  }

  function removeStaticDemoData() {
    document.querySelectorAll('.calendar,.event').forEach(e => e.remove());
    document.querySelectorAll('#view-agenda .cb-demo-agenda,#view-agenda [data-demo="true"]').forEach(e => e.remove());
    const tbody = document.querySelector('#clientTable tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty">Cargando clientes reales…</td></tr>';
    const agenda = document.querySelector('#view-agenda');
    if (agenda) agenda.querySelectorAll('table').forEach(t => { if (!t.closest('.cb-production-agenda')) t.remove(); });
    document.querySelectorAll('#view-clients .metric,#view-dashboard .metric,#view-reports .metric,#view-revenue .metric,#view-marketing .metric').forEach(card => {
      const text = (card.textContent || '').toLowerCase();
      if (/248|96|38\.7%|12 este mes|por recuperar\s*7|480k|480\.000|7 clientes|8\.4m|186|78%|64%|1\.8m|31|59\.900/.test(text)) {
        const strong = card.querySelector('strong');
        if (strong) strong.textContent = '0';
        card.querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales');
      }
    });
    document.querySelectorAll('#view-marketing > .card').forEach(c => c.innerHTML = '<div class="empty">Cargando campañas reales…</div>');
    document.querySelectorAll('#view-reports > .grid2').forEach(g => g.innerHTML = '<div class="card"><b style="font-size:13px">Citas por día</b><div class="empty">Cargando datos reales…</div></div><div class="card"><b style="font-size:13px">Servicios más solicitados</b><div class="empty">Cargando datos reales…</div></div>');
  }

  async function refreshRealClientMetrics() {
    try {
      const business = await getBusiness();
      const [{ data: customers, error: ce }, { data: appointments, error: ae }] = await Promise.all([
        client.from('customers').select('id').eq('business_id', business.id),
        client.from('appointments').select('customer_id,starts_at,status').eq('business_id', business.id)
      ]);
      if (ce) throw ce;
      if (ae) throw ae;
      const counts = {}, last = {};
      for (const a of appointments || []) {
        if (a.customer_id) counts[a.customer_id] = (counts[a.customer_id] || 0) + 1;
        if (a.customer_id && a.starts_at && (!last[a.customer_id] || new Date(a.starts_at) > new Date(last[a.customer_id]))) last[a.customer_id] = a.starts_at;
      }
      const frequent = Object.values(counts).filter(n => n >= 3).length;
      const inactive = Object.values(last).filter(d => Date.now() - new Date(d).getTime() > 30 * 864e5).length;
      const cards = document.querySelectorAll('#view-clients .metric');
      [[0,(customers || []).length],[1,frequent],[2,inactive]].forEach(([i,v]) => { const el = cards[i]?.querySelector('strong'); if (el) el.textContent = String(v); });
      cards.forEach(c => c.querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales'));
    } catch (e) { console.error('CITABOT_REAL_METRICS_ERROR', e); }
  }

  function zonedDateTimeToUtc(date,time,timeZone){
    const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
    if(![year,month,day,hour,minute].every(Number.isFinite)) return null;
    let ts=Date.UTC(year,month-1,day,hour,minute);
    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    for(let i=0;i<2;i++){
      const parts=Object.fromEntries(fmt.formatToParts(new Date(ts)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
      ts += Date.UTC(year,month-1,day,hour,minute)-Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
    }
    return new Date(ts);
  }

  async function bookInternalAppointment() {
    const business = await getBusiness();
    const customerId = $('mCustomer')?.value?.trim();
    const serviceId = $('mService')?.value?.trim();
    const staffId = $('mStaff')?.value?.trim();
    const startRaw = $('mStart')?.value?.trim();
    if (!customerId || !serviceId || !staffId || !startRaw) throw new Error('Completa cliente, servicio, profesional y fecha.');
    const { data: customer, error: ce } = await client.from('customers').select('name,phone,email').eq('id', customerId).eq('business_id', business.id).single();
    if (ce || !customer) throw new Error('Cliente no válido para este negocio.');
    if (!customer.phone) throw new Error('El cliente debe tener un número de WhatsApp para crear la cita.');
    const { data: service, error: se } = await client.from('services').select('id,duration_minutes,active').eq('id', serviceId).eq('business_id', business.id).single();
    if (se || !service?.active) throw new Error('Servicio no disponible.');
    const parts=startRaw.split('T');
    const dt=parts.length===2?zonedDateTimeToUtc(parts[0],parts[1],business.timezone||'America/Bogota'):new Date(startRaw);
    if(!dt||Number.isNaN(dt.getTime())||dt<=new Date()) throw new Error('La fecha y hora deben ser futuras.');
    const {data:result,error}=await client.functions.invoke('citabot-public-booking',{body:{business_slug:business.slug,service_id:serviceId,staff_id:staffId,customer_name:customer.name,customer_phone:customer.phone,customer_email:customer.email||null,starts_at:dt.toISOString(),customer_notes:$('mNote')?.value?.trim()||null}});
    if(error) throw error;
    if(!result?.ok) throw new Error(result?.error||'No fue posible crear la cita.');
    if(window.closeModal) window.closeModal();
    if(typeof window.loadCitaBotData==='function') await window.loadCitaBotData();
    else if(typeof window.load==='function') await window.load();
    toast('Cita guardada correctamente.');
  }

  function installInternalSaveGuard(){
    if(window.__citabotInternalSaveGuardInstalled)return;
    window.__citabotInternalSaveGuardInstalled=true;
    document.addEventListener('click',async event=>{
      const button=event.target?.closest?.('button');
      if(!button||(button.textContent||'').trim().toLowerCase()!=='guardar')return;
      const type=(document.getElementById('modalTitle')?.textContent||'').trim();
      if(type!=='Nueva cita'&&type!=='Nueva reserva')return;
      if(!$('mCustomer')||!$('mService')||!$('mStaff')||!$('mStart'))return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();
      if(button.disabled)return;
      button.disabled=true;
      try{await bookInternalAppointment();}catch(e){console.error('CITABOT_INTERNAL_APPOINTMENT_ERROR',e);toast(e?.message||'No se pudo guardar la cita.');}finally{button.disabled=false;}
    },true);
  }

  function installSafeInternalAppointmentFlow(attempt=0){
    const original=window.confirmModal;
    if(typeof original!=='function'){if(attempt<20)setTimeout(()=>installSafeInternalAppointmentFlow(attempt+1),100);return;}
    if(window.__citabotSafeAppointmentFlowInstalled)return;
    window.__citabotSafeAppointmentFlowInstalled=true;
    window.confirmModal=async function(){
      const type=(document.getElementById('modalTitle')?.textContent||'').trim();
      if(type!=='Nueva cita'&&type!=='Nueva reserva')return original.apply(this,arguments);
      try{await bookInternalAppointment();}catch(e){console.error('CITABOT_INTERNAL_APPOINTMENT_ERROR',e);toast(e?.message||'No se pudo guardar la cita.');}
    };
  }

  async function publicBookingViaFunction(slug){
    const book=$('cbBook'),body=$('cbBookBody');if(!book||!body)return;
    $('landing')?.classList.remove('active');$('app')?.style.setProperty('display','none');book.style.display='block';body.innerHTML='<p>Cargando agenda…</p>';
    try{
      const r=await fetch(`${SUPABASE_URL}/functions/v1/citabot-public-booking?slug=${encodeURIComponent(slug)}`,{headers:{apikey:SUPABASE_KEY}});if(!r.ok)throw new Error('No fue posible cargar la agenda.');
      const payload=await r.json();if(!payload?.ok)throw new Error(payload?.error||'Agenda no disponible');
      const pub=payload.data,b=pub.business,services=pub.services||[],staff=pub.staff||[],tz=b?.timezone||'America/Bogota';if(!b)throw new Error('Negocio no disponible');
      if(!services.length||!staff.length){body.innerHTML=`<h1>${esc(b.name)}</h1><p>Este negocio todavía no configuró servicios o profesionales.</p>`;return;}
      body.innerHTML=`<h1>${esc(b.name)}</h1><p>${esc(b.city||'')} · Reserva en línea</p><div class="cb-book-grid"><div><label>Servicio</label><select id="cbpService">${services.map(x=>`<option value="${x.id}">${esc(x.name)} · ${money(x.price)} · ${x.duration_minutes} min</option>`).join('')}</select></div><div><label>Profesional</label><select id="cbpStaff">${staff.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div><label>Fecha</label><input id="cbpDate" type="date" min="${new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(new Date())}"></div><div><label>Hora</label><input id="cbpTime" type="time"></div><div><label>Tu nombre</label><input id="cbpName"></div><div><label>WhatsApp</label><input id="cbpPhone" type="tel"></div><div><label>Email</label><input id="cbpEmail" type="email"></div><div class="full"><label>Nota</label><textarea id="cbpNote"></textarea></div></div><button id="cbpSubmit" class="btn primary" style="margin-top:16px">Confirmar reserva</button><div id="cbpMsg" style="margin-top:12px"></div>`;
      $('cbpSubmit').onclick=async()=>{
        const get=id=>$(id)?.value?.trim()||'',starts=zonedDateTimeToUtc(get('cbpDate'),get('cbpTime'),tz);
        if(!get('cbpDate')||!get('cbpTime')||!get('cbpName')||!get('cbpPhone')){$('cbpMsg').innerHTML='<div class="cb-error">Completa nombre, WhatsApp, fecha y hora.</div>';return}
        if(!starts||Number.isNaN(starts.getTime())||starts<=new Date()){$('cbpMsg').innerHTML='<div class="cb-error">Selecciona una fecha y hora futuras.</div>';return}
        $('cbpSubmit').disabled=true;
        try{const {data:res,error:err}=await client.functions.invoke('citabot-public-booking',{body:{business_slug:slug,service_id:get('cbpService'),staff_id:get('cbpStaff'),customer_name:get('cbpName'),customer_phone:get('cbpPhone'),customer_email:get('cbpEmail')||null,starts_at:starts.toISOString(),customer_notes:get('cbpNote')||null}});if(err)throw err;if(!res?.ok)throw new Error(res?.error||'No fue posible guardar la reserva.');$('cbpMsg').innerHTML='<div class="cb-ok"><b>¡Reserva confirmada!</b><br>La reserva quedó registrada correctamente en CitaBot.</div>';}catch(e){$('cbpMsg').innerHTML=`<div class="cb-error">${esc(e?.message||'No fue posible guardar la reserva.')}</div>`}finally{$('cbpSubmit').disabled=false}
      };
    }catch(e){console.error('CITABOT_PUBLIC_BOOKING_ERROR',e);body.innerHTML=`<div class="cb-error">${esc(e?.message||'No fue posible cargar la agenda.')}</div>`}
  }

  function renderMarketingReal(){const s=document.getElementById('view-marketing');if(!s)return;const d=window.__citabotRuntimeData||{},c=d.campaigns||[],m=d.messages||[],u=d.customers||[],x=s.querySelectorAll('.metric strong');if(x[0])x[0].textContent=c.filter(v=>['active','scheduled'].includes(v.status)).length;if(x[1])x[1].textContent=m.filter(v=>v.direction==='outbound').length;if(x[2])x[2].textContent=u.length;const box=s.querySelector(':scope > .card');if(box)box.innerHTML=c.length?c.map(v=>`<div class="campaign"><div><b>${esc(v.name)}</b><small>${esc(v.channel||'')} · ${esc(v.segment||'')}</small></div><span class="badge ${v.status==='active'?'confirmed':'pending'}">${esc(v.status||'')}</span></div>`).join(''):'<div class="empty">No hay campañas registradas.</div>';}
  function renderReportsReal(){const s=document.getElementById('view-reports');if(!s)return;const d=window.__citabotRuntimeData||{},a=d.appointments||[],sv=d.services||[],g=s.querySelectorAll(':scope > .grid2');if(!g.length)return;const by=[0,0,0,0,0,0,0],sc={};a.forEach(v=>{const dt=new Date(v.starts_at);if(!Number.isNaN(dt.getTime()))by[dt.getDay()]++;if(v.service_id)sc[v.service_id]=(sc[v.service_id]||0)+1;});const names=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];const rows=names.map((n,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${n}</span><b>${by[i]}</b></div>`).join('');const sr=Object.entries(sc).sort((x,y)=>y[1]-x[1]).slice(0,8).map(([id,n])=>`<tr><td>${esc(sv.find(v=>v.id===id)?.name||'Servicio')}</td><td>${n}</td></tr>`).join('')||'<tr><td colspan="2" class="empty">No hay citas todavía.</td></tr>';g[0].innerHTML=`<div class="card"><b style="font-size:13px">Citas por día</b><div style="margin-top:12px">${rows}</div></div><div class="card"><b style="font-size:13px">Servicios más solicitados</b><table class="table"><thead><tr><th>Servicio</th><th>Citas</th></tr></thead><tbody>${sr}</tbody></table></div>`;}
  function renderRevenueReal(){const s=document.getElementById('view-revenue');if(!s)return;const d=window.__citabotRuntimeData||{},p=d.payments||[],sub=d.subscription,r=p.filter(v=>v.status==='paid').reduce((n,v)=>n+Number(v.amount||0),0),cnt=p.filter(v=>v.status==='paid').length,m=s.querySelectorAll('.metric'),set=(i,l,v,t)=>{const c=m[i];if(!c)return;const a=c.querySelector('small'),b=c.querySelector('strong'),q=c.querySelector('.trend');if(a)a.textContent=l;if(b)b.textContent=v;if(q)q.textContent=t;};set(0,'Ingresos cobrados',money(r),'Datos reales');set(1,'Pagos realizados',String(cnt),'Datos reales');set(2,'Ticket medio',money(cnt?r/cnt:0),'Pagos reales');set(3,'Suscripción',sub?.status||'Sin suscripción','Estado real');const tb=s.querySelector('table tbody');if(tb)tb.innerHTML=p.slice(0,50).map(v=>`<tr><td>${esc(v.concept||'Cobro')}</td><td>${money(v.amount)}</td><td>${esc(v.method||'')}</td><td><span class="badge ${v.status==='paid'?'confirmed':'pending'}">${esc(v.status||'')}</span></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No hay pagos registrados.</td></tr>';}

  async function syncMetaStatus(){try{const r=await client.functions.invoke('citabot-meta-sync',{body:{}}),ok=!r.error&&r.data?.subscribed===true,grid=document.querySelector('#view-settings .grid3'),card=grid&&[...grid.children].find(x=>(x.textContent||'').includes('WhatsApp + IA'));if(card){const b=card.querySelector('.badge'),p=card.querySelector('p');if(b){b.textContent=ok?'Conectado':'Pendiente de verificación';b.className=ok?'badge confirmed':'badge pending';}if(p)p.textContent=ok?'Meta confirmó la suscripción de WhatsApp.':'La conexión está configurada, pero Meta aún no fue confirmada por la cuenta.';}}catch(e){console.error('CITABOT_META_STATUS_ERROR',e);}}

  function bootClosure(){removeFakeSurface();removeStaticDemoData();installSafeInternalAppointmentFlow();installInternalSaveGuard();setTimeout(()=>{removeFakeSurface();removeStaticDemoData();refreshRealClientMetrics();renderMarketingReal();renderReportsReal();renderRevenueReal();},800);setTimeout(refreshRealClientMetrics,1800);setTimeout(syncMetaStatus,1200);const p=new URLSearchParams(location.search),q=p.get('book'),h=location.hash.match(/^#book=([^&]+)/),slug=q||(h?decodeURIComponent(h[1]):null);if(slug)setTimeout(()=>publicBookingViaFunction(slug),120);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootClosure,{once:true});else bootClosure();
})();
