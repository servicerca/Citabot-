// CitaBot production closure: authoritative UI cleanup + real WhatsApp + public booking through Edge Function.
(() => {
  'use strict';
  const SUPABASE_URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XjqZnyBiOxC1fLNE9rJxQw_9xzEXquH';
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!client) return;
  const $ = (id) => document.getElementById(id);
  const toast = (m) => window.showToast ? window.showToast(m) : console.log(m);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
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

  // Remove the remaining static demo calendar/events before the live data renderer runs.
  function removeStaticDemoData() {
    document.querySelectorAll('.calendar').forEach(e => e.remove());
    document.querySelectorAll('.event').forEach(e => e.remove());
    document.querySelectorAll('#view-agenda .cb-demo-agenda, #view-agenda [data-demo="true"]').forEach(e => e.remove());

    // Clear static client rows/metrics only when the live renderer is about to replace them.
    const clientTable = document.querySelector('#clientTable tbody');
    if (clientTable) clientTable.innerHTML = '<tr><td colspan="5" class="empty">Cargando clientes reales…</td></tr>';

    const agenda = document.querySelector('#view-agenda');
    if (agenda) {
      const tables = agenda.querySelectorAll('table');
      tables.forEach(t => {
        if (!t.closest('.cb-production-agenda')) t.remove();
      });
    }

    // Never allow known demo KPI values to remain visible while live data is loading.
    document.querySelectorAll('#view-clients .metric, #view-dashboard .metric, #view-reports .metric, #view-revenue .metric, #view-marketing .metric').forEach(card => {
      const text = (card.textContent || '').toLowerCase();
      if (/248|96|38\.7%|12 este mes|por recuperar\s*7|480k|480\.000|7 clientes/.test(text)) {
        const strong = card.querySelector('strong');
        if (strong) strong.textContent = '0';
        card.querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales');
      }
    });
  }

  function setRealClientMetrics(count, frequent, inactive) {
    const cards = document.querySelectorAll('#view-clients .metric');
    if (cards[0]) {
      const v = cards[0].querySelector('strong'); if (v) v.textContent = String(count);
      cards[0].querySelectorAll('.trend').forEach(t => t.textContent = count ? 'Datos reales' : 'Sin clientes todavía');
    }
    if (cards[1]) {
      const v = cards[1].querySelector('strong'); if (v) v.textContent = String(frequent);
      cards[1].querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales');
    }
    if (cards[2]) {
      const v = cards[2].querySelector('strong'); if (v) v.textContent = String(inactive);
      cards[2].querySelectorAll('.trend').forEach(t => t.textContent = 'Datos reales');
    }
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
      const frequentIds = new Set(rows.filter(a => !['cancelled','no_show'].includes(a.status)).reduce((acc, a) => {
        acc[a.customer_id] = (acc[a.customer_id] || 0) + 1; return acc;
      }, {}));
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
    } catch (e) {
      console.error('CITABOT_REAL_METRICS_ERROR', e);
    }
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

  function bootClosure() {
    removeFakeSurface();
    removeStaticDemoData();
    setTimeout(() => { removeFakeSurface(); removeStaticDemoData(); refreshRealClientMetrics(); }, 800);
    setTimeout(refreshRealClientMetrics, 1800);
    const params=new URLSearchParams(location.search);const q=params.get('book');const h=location.hash.match(/^#book=([^&]+)/);const slug=q||(h?decodeURIComponent(h[1]):null);
    if(slug) setTimeout(()=>publicBookingViaFunction(slug),120);
    setTimeout(syncMetaStatus,1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootClosure, { once: true }); else bootClosure();
})();
