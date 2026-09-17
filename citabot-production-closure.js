// CitaBot production closure: authoritative UI cleanup + real WhatsApp + public booking through Edge Function.
(() => {
  'use strict';
  const SUPABASE_URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XjqZnyBiOxC1fLNE9rJxQw_9xzEXquH';
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!client) return;
  const $ = (id) => document.getElementById(id);
  const toast = (m) => window.showToast ? window.showToast(m) : console.log(m);
  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
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
    document.querySelectorAll('.calendar').forEach(e => e.remove());
    document.querySelectorAll('.event').forEach(e => e.remove());
    document.querySelectorAll('#view-agenda .cb-demo-agenda, #view-agenda [data-demo="true"]').forEach(e => e.remove());
    const clientTable = document.querySelector('#clientTable tbody');
    if (clientTable) clientTable.innerHTML = '<tr><td colspan="5" class="empty">Cargando clientes reales…</td></tr>';
    const agenda = document.querySelector('#view-agenda');
    if (agenda) {
      const tables = agenda.querySelectorAll('table');
      tables.forEach(t => { if (!t.closest('.cb-production-agenda')) t.remove(); });
    }
    document.querySelectorAll('#view-clients .metric, #view-dashboard .metric, #view-reports .metric, #view-revenue .metric, #view-marketing .metric').forEach(card => {
      const text = (card.textContent || '').toLowerCase();
      if (/248|96|38\.7%|12 este mes|por recuperar\s*7|480k|480\.000|7 clientes|8\.4m|186|78%|64%|1\.8m|31|59\.900/.test(text)) {
        const strong = card.querySelector('strong');
        if (strong) strong.textContent = '0';
        card.querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales');
      }
    });
    const marketing = document.getElementById('view-marketing');
    if (marketing) {
      const campaignCards = marketing.querySelectorAll(':scope > .card');
      campaignCards.forEach(c => c.innerHTML = '<div class="empty">Cargando campañas reales…</div>');
    }
    const reports = document.getElementById('view-reports');
    if (reports) {
      const grids = reports.querySelectorAll(':scope > .grid2');
      grids.forEach(g => g.innerHTML = '<div class="card"><b style="font-size:13px">Citas por día</b><div class="empty">Cargando datos reales…</div></div><div class="card"><b style="font-size:13px">Servicios más solicitados</b><div class="empty">Cargando datos reales…</div></div>');
    }
  }

  function setRealClientMetrics(count, frequent, inactive) {
    const cards = document.querySelectorAll('#view-clients .metric');
    if (cards[0]) { const v = cards[0].querySelector('strong'); if (v) v.textContent = String(count); cards[0].querySelectorAll('.trend').forEach(t => t.textContent = count ? 'Datos reales' : 'Sin clientes todavía'); }
    if (cards[1]) { const v = cards[1].querySelector('strong'); if (v) v.textContent = String(frequent); cards[1].querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales'); }
    if (cards[2]) { const v = cards[2].querySelector('strong'); if (v) v.textContent = String(inactive); cards[2].querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales'); }
  }

  async function refreshRealClientMetrics() {
    try {
      const business = await getBusiness();
      const bid = business.id;
      const [{ data: customers, error: ce }, { data: appointments, error: ae }] = await Promise.all([
        client.from('customers').select('id').eq('business_id', bid),
        client.from('appointments').select('customer_id,starts_at,status').eq('business_id', bid)
      ]);
      if (ce) throw ce; if (ae) throw ae;
      const rows = appointments || [];
      const counts = {};
      for (const a of rows) counts[a.customer_id] = (counts[a.customer_id] || 0) + 1;
      const frequent = Object.values(counts).filter(n => n >= 3).length;
      const last = {};
      for (const a of rows) {
        if (!a.customer_id || !a.starts_at) continue;
        if (!last[a.customer_id] || new Date(a.starts_at) > new Date(last[a.customer_id])) last[a.customer_id] = a.starts_at;
      }
      const inactive = Object.values(last).filter(d => Date.now() - new Date(d).getTime() > 30 * 864e5).length;
      setRealClientMetrics((customers || []).length, frequent, inactive);
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

  async function publicBookingViaFunction(slug){
    const book=$('cbBook'); const body=$('cbBookBody');
    if(!book || !body) return;
    $('landing')?.classList.remove('active'); $('app')?.style.setProperty('display','none'); book.style.display='block';
    body.innerHTML='<p>Cargando agenda…</p>';
    try{
      const r=await fetch(`${SUPABASE_URL}/functions/v1/citabot-public-booking?slug=${encodeURIComponent(slug)}`,{headers:{apikey:SUPABASE_KEY}});
      if(!r.ok) throw new Error('No fue posible cargar la agenda.');
      const payload=await r.json();
      if(!payload?.ok) throw new Error(payload?.error||'Agenda no disponible');
      const pub=payload.data,b=pub.business,services=pub.services||[],staff=pub.staff||[],tz=b?.timezone||'America/Bogota';
      if(!b) throw new Error('Negocio no disponible');
      if(!services.length||!staff.length){body.innerHTML=`<h1>${esc(b.name)}</h1><p>Este negocio todavía no configuró servicios o profesionales.</p>`;return;}
      body.innerHTML=`<h1>${esc(b.name)}</h1><p>${esc(b.city||'')} · Reserva en línea</p><div class="cb-book-grid"><div><label>Servicio</label><select id="cbpService">${services.map(x=>`<option value="${x.id}">${esc(x.name)} · ${money(x.price)} · ${x.duration_minutes} min</option>`).join('')}</select></div><div><label>Profesional</label><select id="cbpStaff">${staff.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div><label>Fecha</label><input id="cbpDate" type="date" min="${new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(new Date())}"></div><div><label>Hora</label><input id="cbpTime" type="time"></div><div><label>Tu nombre</label><input id="cbpName"></div><div><label>WhatsApp</label><input id="cbpPhone" type="tel"></div><div><label>Email</label><input id="cbpEmail" type="email"></div><div class="full"><label>Nota</label><textarea id="cbpNote"></textarea></div></div><button id="cbpSubmit" class="btn primary" style="margin-top:16px">Confirmar reserva</button><div id="cbpMsg" style="margin-top:12px"></div><p style="font-size:10px;color:#888;margin-top:18px">Al reservar, aceptas que el negocio use estos datos para gestionar tu cita.</p>`;
      $('cbpSubmit').onclick=async()=>{
        const get=id=>$(id)?.value?.trim()||'';const starts=zonedDateTimeToUtc(get('cbpDate'),get('cbpTime'),tz);
        if(!get('cbpDate')||!get('cbpTime')||!get('cbpName')||!get('cbpPhone')){$('cbpMsg').innerHTML='<div class="cb-error">Completa nombre, WhatsApp, fecha y hora.</div>';return}
        if(!starts||Number.isNaN(starts.getTime())||starts<=new Date()){$('cbpMsg').innerHTML='<div class="cb-error">Selecciona una fecha y hora futuras.</div>';return}
        $('cbpSubmit').disabled=true;$('cbpMsg').innerHTML='<p style="color:#777;font-size:12px">Guardando reserva…</p>';
        try{
          const {data:res,error:err}=await client.functions.invoke('citabot-public-booking',{body:{business_slug:slug,service_id:get('cbpService'),staff_id:get('cbpStaff'),customer_name:get('cbpName'),customer_phone:get('cbpPhone'),customer_email:get('cbpEmail')||null,starts_at:starts.toISOString(),customer_notes:get('cbpNote')||null}});
          if(err)throw err;if(!res?.ok)throw new Error(res?.error||'No fue posible guardar la reserva.');
          $('cbpMsg').innerHTML='<div class="cb-ok"><b>¡Reserva confirmada!</b><br>La reserva quedó registrada correctamente en CitaBot.</div>';
        }catch(e){$('cbpMsg').innerHTML=`<div class="cb-error">${esc(e?.message||'No fue posible guardar la reserva.')}</div>`}finally{$('cbpSubmit').disabled=false}
      };
    }catch(e){console.error('CITABOT_PUBLIC_BOOKING_ERROR',e);body.innerHTML=`<div class="cb-error">${esc(e?.message||'No fue posible cargar la agenda.')}</div>`}
  }

  async function syncMetaStatus() {
    try {
      const result = await client.functions.invoke('citabot-meta-sync', { body: {} });
      const ok = !result.error && result.data?.subscribed === true;
      const grid = document.querySelector('#view-settings .grid3');
      if (grid) {
        const card = [...grid.children].find(x => (x.textContent || '').includes('WhatsApp + IA'));
        if (card) {
          const badge = card.querySelector('.badge'); const p = card.querySelector('p');
          if (ok) { if (badge) { badge.textContent='Conectado'; badge.className='badge confirmed'; } if (p) p.textContent='Meta confirmó la suscripción de WhatsApp.'; }
          else { if (badge) { badge.textContent='Pendiente de verificación'; badge.className='badge pending'; } if (p) p.textContent='La conexión está configurada, pero Meta aún no fue confirmada por la cuenta.'; }
        }
      }
    } catch (e) {
      const grid = document.querySelector('#view-settings .grid3'); const card = grid && [...grid.children].find(x => (x.textContent || '').includes('WhatsApp + IA'));
      if (card) { const badge = card.querySelector('.badge'); if (badge) { badge.textContent='Pendiente de verificación'; badge.className='badge pending'; } }
    }
  }

  function installSafeInternalAppointmentFlow(attempt = 0) {
    const originalConfirmModal = window.confirmModal;
    if (typeof originalConfirmModal !== 'function') {
      if (attempt < 20) setTimeout(() => installSafeInternalAppointmentFlow(attempt + 1), 100);
      return;
    }
    if (window.__citabotSafeAppointmentFlowInstalled) return;
    window.__citabotSafeAppointmentFlowInstalled = true;
    window.confirmModal = async function() {
      const type = window.state?.modalType || '';
      if (type !== 'Nueva cita' && type !== 'Nueva reserva') return originalConfirmModal.apply(this, arguments);
      try {
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
        const dt = new Date(startRaw);
        if (Number.isNaN(dt.getTime()) || dt <= new Date()) throw new Error('La fecha y hora deben ser futuras.');
        const payload = {
          business_slug: business.slug,
          service_id: serviceId,
          staff_id: staffId,
          customer_name: customer.name,
          customer_phone: customer.phone,
          customer_email: customer.email || null,
          starts_at: dt.toISOString(),
          customer_notes: $('mNote')?.value?.trim() || null
        };
        const { data: result, error } = await client.functions.invoke('citabot-public-booking', { body: payload });
        if (error) throw error;
        if (!result?.ok) throw new Error(result?.error || 'No fue posible crear la cita.');
        if (window.closeModal) window.closeModal();
        if (typeof window.loadCitaBotData === 'function') await window.loadCitaBotData();
        toast('Cita guardada correctamente.');
      } catch (e) {
        console.error('CITABOT_INTERNAL_APPOINTMENT_ERROR', e);
        toast(e?.message || 'No se pudo guardar la cita.');
      }
    };
  }

  function renderMarketingReal() {
    const section = document.getElementById('view-marketing');
    if (!section) return;
    const metrics = section.querySelectorAll('.metric strong');
    const campaignRows = window.__citabotRuntimeData?.campaigns || [];
    const messageRows = window.__citabotRuntimeData?.messages || [];
    const customerRows = window.__citabotRuntimeData?.customers || [];
    if (metrics[0]) metrics[0].textContent = campaignRows.filter(c => ['active','scheduled'].includes(c.status)).length;
    if (metrics[1]) metrics[1].textContent = messageRows.filter(m => m.direction === 'outbound').length;
    if (metrics[2]) metrics[2].textContent = customerRows.filter(c => true).length;
    const box = section.querySelector(':scope > .card');
    if (box) box.innerHTML = campaignRows.length ? campaignRows.map(c => `<div class="campaign"><div><b>${esc(c.name)}</b><small>${esc(c.channel || '')} · ${esc(c.segment || '')}</small></div><span class="badge ${c.status==='active'?'confirmed':'pending'}">${esc(c.status || '')}</span></div>`).join('') : '<div class="empty">No hay campañas registradas.</div>';
  }

  function renderReportsReal() {
    const section = document.getElementById('view-reports');
    if (!section) return;
    const appointments = window.__citabotRuntimeData?.appointments || [];
    const services = window.__citabotRuntimeData?.services || [];
    const grids = section.querySelectorAll(':scope > .grid2');
    if (!grids.length) return;
    const byDay = [0,0,0,0,0,0,0];
    const serviceCounts = {};
    appointments.forEach(a => {
      const d = new Date(a.starts_at);
      if (!Number.isNaN(d.getTime())) byDay[d.getDay()]++;
      if (a.service_id) serviceCounts[a.service_id] = (serviceCounts[a.service_id] || 0) + 1;
    });
    const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const dayRows = dayNames.map((name,i) => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${name}</span><b>${byDay[i]}</b></div>`).join('');
    const serviceRows = Object.entries(serviceCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([id,n]) => `<tr><td>${esc(services.find(s=>s.id===id)?.name || 'Servicio')}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No hay citas todavía.</td></tr>';
    grids[0].innerHTML = `<div class="card"><b style="font-size:13px">Citas por día</b><div style="margin-top:12px">${dayRows}</div></div><div class="card"><b style="font-size:13px">Servicios más solicitados</b><table class="table"><thead><tr><th>Servicio</th><th>Citas</th></tr></thead><tbody>${serviceRows}</tbody></table></div>`;
  }

  function renderRevenueReal() {
    const section = document.getElementById('view-revenue');
    if (!section) return;
    const payments = window.__citabotRuntimeData?.payments || [];
    const customers = window.__citabotRuntimeData?.customers || [];
    const subscriptions = window.__citabotRuntimeData?.subscription;
    const revenue = payments.filter(p => p.status === 'paid').reduce((n,p) => n + Number(p.amount || 0), 0);
    const paidCount = payments.filter(p => p.status === 'paid').length;
    const metrics = section.querySelectorAll('.metric');
    const set = (i,label,value,trend) => { const c=metrics[i]; if(!c)return; const s=c.querySelector('small'),v=c.querySelector('strong'),t=c.querySelector('.trend'); if(s)s.textContent=label; if(v)v.textContent=value; if(t)t.textContent=trend; };
    set(0,'Ingresos cobrados',money(revenue),'Datos reales');
    set(1,'Pagos realizados',String(paidCount),'Datos reales');
    set(2,'Ticket medio',money(paidCount ? revenue/paidCount : 0),'Pagos reales');
    set(3,'Suscripción',subscriptions?.status || 'Sin suscripción','Estado real');
    const table=section.querySelector('table tbody');
    if(table) table.innerHTML=payments.slice(0,50).map(p=>`<tr><td>${esc(p.concept||'Cobro')}</td><td>${money(p.amount)}</td><td>${esc(p.method||'')}</td><td><span class="badge ${p.status==='paid'?'confirmed':'pending'}">${esc(p.status||'')}</span></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No hay pagos registrados.</td></tr>';
    void customers;
  }
\n\n  function installInternalSaveGuard() {\n    if (window.__citabotInternalSaveGuardInstalled) return;\n    window.__citabotInternalSaveGuardInstalled = true;\n    document.addEventListener('click', async (event) => {\n      const button = event.target?.closest?.('button');\n      if (!button || (button.textContent || '').trim().toLowerCase() !== 'guardar') return;\n      const type = window.state?.modalType || '';\n      if (type !== 'Nueva cita' && type !== 'Nueva reserva') return;\n      if (!$('mCustomer') || !$('mService') || !$('mStaff') || !$('mStart')) return;\n      event.preventDefault();\n      event.stopPropagation();\n      if (event.stopImmediatePropagation) event.stopImmediatePropagation();\n      if (button.disabled) return;\n      button.disabled = true;\n      try {\n        const business = await getBusiness();\n        const customerId = $('mCustomer')?.value?.trim();\n        const serviceId = $('mService')?.value?.trim();\n        const staffId = $('mStaff')?.value?.trim();\n        const startRaw = $('mStart')?.value?.trim();\n        if (!customerId || !serviceId || !staffId || !startRaw) throw new Error('Completa cliente, servicio, profesional y fecha.');\n        const { data: customer, error: ce } = await client.from('customers').select('name,phone,email').eq('id', customerId).eq('business_id', business.id).single();\n        if (ce || !customer) throw new Error('Cliente no válido para este negocio.');\n        if (!customer.phone) throw new Error('El cliente debe tener un número de WhatsApp para crear la cita.');\n        const { data: service, error: se } = await client.from('services').select('id,duration_minutes,active').eq('id', serviceId).eq('business_id', business.id).single();\n        if (se || !service?.active) throw new Error('Servicio no disponible.');\n        const parts = startRaw.split('T');\n        const dt = parts.length === 2 && typeof zonedDateTimeToUtc === 'function' ? zonedDateTimeToUtc(parts[0], parts[1], business.timezone || 'America/Bogota') : new Date(startRaw);\n        if (!dt || Number.isNaN(dt.getTime()) || dt <= new Date()) throw new Error('La fecha y hora deben ser futuras.');\n        const { data: result, error } = await client.functions.invoke('citabot-public-booking', { body: {\n          business_slug: business.slug,\n          service_id: serviceId,\n          staff_id: staffId,\n          customer_name: customer.name,\n          customer_phone: customer.phone,\n          customer_email: customer.email || null,\n          starts_at: dt.toISOString(),\n          customer_notes: $('mNote')?.value?.trim() || null\n        }});\n        if (error) throw error;\n        if (!result?.ok) throw new Error(result?.error || 'No fue posible crear la cita.');\n        if (window.closeModal) window.closeModal();\n        if (typeof window.loadCitaBotData === 'function') await window.loadCitaBotData();\n        else if (typeof window.load === 'function') await window.load();\n        toast('Cita guardada correctamente.');\n      } catch (e) {\n        console.error('CITABOT_INTERNAL_SAVE_GUARD_ERROR', e);\n        toast(e?.message || 'No se pudo guardar la cita.');\n      } finally {\n        button.disabled = false;\n      }\n    }, true);\n  }\n  // CITABOT_INTERNAL_SAVE_GUARD_V1\n
  function bootClosure() {
    removeFakeSurface();
    removeStaticDemoData();
    installSafeInternalAppointmentFlow();
    installInternalSaveGuard();
    setTimeout(() => { removeFakeSurface(); removeStaticDemoData(); refreshRealClientMetrics(); installSafeInternalAppointmentFlow(); renderMarketingReal(); renderReportsReal(); renderRevenueReal(); }, 800);
    setTimeout(refreshRealClientMetrics, 1800);
    const params=new URLSearchParams(location.search);const q=params.get('book');const h=location.hash.match(/^#book=([^&]+)/);const slug=q||(h?decodeURIComponent(h[1]):null);
    if(slug) setTimeout(()=>publicBookingViaFunction(slug),120);
    setTimeout(syncMetaStatus,1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootClosure, { once: true }); else bootClosure();
})();
