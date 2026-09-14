(() => {
  'use strict';
  const URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const KEY = 'sb_publishable_XjqZnyBiOxC1fLNE9rJxQw_9xzEXquH';
  const client = window.supabase?.createClient(URL, KEY);
  if (!client) return;

  const $ = (id) => document.getElementById(id);
  let business = null;
  let data = { services: [], staff: [], customers: [], appointments: [], messages: [], campaigns: [], payments: [], subscription: null };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const money = (v) => '$' + Math.round(Number(v || 0)).toLocaleString('es-CO') + ' COP';
  const toast = (m) => window.showToast ? window.showToast(m) : console.log(m);

  function removeDemoSurface() {
    document.querySelectorAll('.demo-hero').forEach((e) => e.remove());
    document.querySelectorAll('button').forEach((b) => {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'ver demo') b.remove();
      if (t.includes('salir de demo')) b.textContent = 'Cerrar sesión';
    });
    document.querySelectorAll('.card').forEach((c) => {
      const t = (c.textContent || '').toLowerCase();
      if (t.includes('estado del mvp') || t.includes('modo demo')) c.remove();
    });
  }

  async function context() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const { data: members, error: me } = await client.from('business_members').select('business_id,role').eq('user_id', user.id);
    if (me) throw me;
    if (!members?.length) return null;
    const ids = members.map((m) => m.business_id);
    const { data: businesses, error: be } = await client.from('businesses').select('*').in('id', ids).eq('is_active', true).limit(1);
    if (be) throw be;
    business = businesses?.[0] || null;
    return business;
  }

  async function load() {
    if (!business) return;
    const bid = business.id;
    const [services, staff, customers, appointments, messages, campaigns, payments, subscription] = await Promise.all([
      client.from('services').select('*').eq('business_id', bid).order('name'),
      client.from('staff').select('*').eq('business_id', bid).order('name'),
      client.from('customers').select('*').eq('business_id', bid).order('created_at', { ascending: false }),
      client.from('appointments').select('*,customers(name,phone),services(name,price),staff(name)').eq('business_id', bid).order('starts_at', { ascending: true }),
      client.from('messages').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(100),
      client.from('campaigns').select('*').eq('business_id', bid).order('created_at', { ascending: false }),
      client.from('payments').select('*').eq('business_id', bid).order('created_at', { ascending: false }).limit(100),
      client.from('subscriptions').select('*').eq('business_id', bid).maybeSingle()
    ]);
    const err = [services, staff, customers, appointments, messages, campaigns, payments, subscription].find((x) => x.error);
    if (err) throw err.error;
    data = {
      services: services.data || [], staff: staff.data || [], customers: customers.data || [], appointments: appointments.data || [],
      messages: messages.data || [], campaigns: campaigns.data || [], payments: payments.data || [], subscription: subscription.data || null
    };
    renderAll();
  }

  function renderDashboard() {
    const metrics = document.querySelectorAll('#view-dashboard .metric strong');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: business?.timezone || 'America/Bogota' }).format(new Date());
    const today = data.appointments.filter(a => a.starts_at?.slice(0,10) === day && !['cancelled','no_show'].includes(a.status));
    const completedRevenue = data.appointments.filter(a => a.status === 'completed').reduce((n,a) => n + Number(a.services?.price || 0), 0);
    const inactive = data.customers.filter(c => {
      const rows = data.appointments.filter(a => a.customer_id === c.id).sort((a,b) => new Date(b.starts_at)-new Date(a.starts_at));
      return rows[0] && Date.now() - new Date(rows[0].starts_at).getTime() > 30*864e5;
    }).length;
    if (metrics[0]) metrics[0].textContent = today.length;
    if (metrics[1]) metrics[1].textContent = data.customers.length;
    if (metrics[2]) metrics[2].textContent = money(completedRevenue);
    if (metrics[3]) metrics[3].textContent = inactive;
    const table = document.querySelector('#view-dashboard .table tbody');
    if (table) {
      table.innerHTML = today.slice(0,8).map(a => `<tr><td>${new Date(a.starts_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</td><td>${esc(a.customers?.name || 'Cliente')}</td><td>${esc(a.services?.name || 'Servicio')}</td><td><span class="badge ${a.status==='confirmed'?'confirmed':'pending'}">${esc(a.status)}</span></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No hay citas para hoy.</td></tr>';
    }
  }

  function renderClients() {
    const metrics = document.querySelectorAll('#view-clients .metric strong');
    const inactive = data.customers.filter(c => {
      const rows = data.appointments.filter(a => a.customer_id === c.id).sort((a,b) => new Date(b.starts_at)-new Date(a.starts_at));
      return rows[0] && Date.now() - new Date(rows[0].starts_at).getTime() > 30*864e5;
    }).length;
    if (metrics[0]) metrics[0].textContent = data.customers.length;
    if (metrics[1]) metrics[1].textContent = data.customers.filter(c => data.appointments.filter(a=>a.customer_id===c.id).length >= 3).length;
    if (metrics[2]) metrics[2].textContent = inactive;
    const table = document.querySelector('#clientTable tbody');
    if (!table) return;
    table.innerHTML = data.customers.map(c => {
      const ap = data.appointments.filter(a => a.customer_id === c.id).sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at));
      const last = ap[0];
      const value = ap.reduce((n,a)=>n+Number(a.services?.price||0),0);
      const isInactive = last && Date.now()-new Date(last.starts_at).getTime()>30*864e5;
      return `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.phone||'')}</small></td><td>${last?new Date(last.starts_at).toLocaleDateString('es-CO'):'—'}</td><td>${ap.length}</td><td>${money(value)}</td><td><span class="badge ${isInactive?'inactive':'confirmed'}">${isInactive?'Por recuperar':'Activo'}</span></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Aún no tienes clientes.</td></tr>';
  }

  function renderAgenda() {
    const section = document.getElementById('view-agenda');
    if (!section) return;
    let live = section.querySelector('.cb-production-agenda');
    if (!live) { live = document.createElement('div'); live.className='card cb-production-agenda'; section.appendChild(live); }
    live.innerHTML = `<div class="section-title" style="margin-top:0"><h2>Agenda real</h2><span>${data.appointments.length} registros</span></div><div style="overflow:auto"><table class="table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Servicio</th><th>Profesional</th><th>Estado</th></tr></thead><tbody>${data.appointments.slice(0,100).map(a=>`<tr><td>${new Date(a.starts_at).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'})}</td><td>${esc(a.customers?.name||'Cliente')}</td><td>${esc(a.services?.name||'Servicio')}</td><td>${esc(a.staff?.name||'')}</td><td><span class="badge ${a.status==='confirmed'?'confirmed':'pending'}">${esc(a.status)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No hay citas todavía.</td></tr>'}</tbody></table></div>`;
  }

  function renderConversations() {
    const main = document.querySelector('#view-conversations .chat-main');
    const list = document.querySelector('#view-conversations .chat-list');
    if (!main || !list) return;
    const grouped = new Map();
    for (const m of [...data.messages].reverse()) {
      if (!m.customer_id) continue;
      if (!grouped.has(m.customer_id)) grouped.set(m.customer_id, []);
      grouped.get(m.customer_id).push(m);
    }
    const customers = [...grouped.keys()].map(id => data.customers.find(c=>c.id===id)).filter(Boolean);
    list.innerHTML = customers.slice(0,30).map((c,i)=>{const rows=grouped.get(c.id)||[];const last=rows[rows.length-1];return `<div class="chat-item ${i===0?'selected':''}" data-customer="${c.id}"><b>${esc(c.name)}</b><small style="display:block;color:var(--muted)">${esc(last?.body||'')}</small></div>`}).join('') || '<div class="empty">Aún no hay conversaciones.</div>';
    const selected = customers[0];
    if (!selected) return;
    const rows = grouped.get(selected.id)||[];
    const head = main.querySelector('div[style*="border-bottom"]');
    if (head) head.innerHTML = `<b style="font-size:12px">${esc(selected.name)}</b><small style="display:block;color:var(--muted);font-size:9px">WhatsApp · ${esc(selected.phone||'')}</small>`;
    const messages = main.querySelector('.messages');
    if (messages) messages.innerHTML = rows.slice(-30).map(m=>`<div class="bubble ${m.direction==='outbound'?'out':'in'}">${esc(m.body)}</div>`).join('') || '<div class="empty">Sin mensajes.</div>';
    list.querySelectorAll('.chat-item').forEach(item=>item.addEventListener('click',()=>{
      list.querySelectorAll('.chat-item').forEach(x=>x.classList.remove('selected'));item.classList.add('selected');
      const id=item.dataset.customer;const c=data.customers.find(x=>x.id===id);const rows2=grouped.get(id)||[];
      if(head) head.innerHTML=`<b style="font-size:12px">${esc(c?.name||'Cliente')}</b><small style="display:block;color:var(--muted);font-size:9px">WhatsApp · ${esc(c?.phone||'')}</small>`;
      if(messages) messages.innerHTML=rows2.slice(-30).map(m=>`<div class="bubble ${m.direction==='outbound'?'out':'in'}">${esc(m.body)}</div>`).join('')||'<div class="empty">Sin mensajes.</div>';
    }));
  }

  function renderMarketing() {
    const metrics=document.querySelectorAll('#view-marketing .metric strong');
    if(metrics[0])metrics[0].textContent=data.campaigns.filter(c=>['active','scheduled'].includes(c.status)).length;
    if(metrics[1])metrics[1].textContent=data.messages.filter(m=>m.direction==='outbound').length;
    if(metrics[2])metrics[2].textContent=data.customers.filter(c=>data.appointments.filter(a=>a.customer_id===c.id).length>0).length;
    const box=document.querySelector('#view-marketing .card:nth-of-type(4)');
    if(box){const rows=data.campaigns.map(c=>`<div class="campaign"><div><b>${esc(c.name)}</b><small>${esc(c.channel)} · ${esc(c.segment)}</small></div><span class="badge ${c.status==='active'?'confirmed':'pending'}">${esc(c.status)}</span></div>`).join('');if(rows)box.innerHTML=rows;}
  }

  function renderReports() {
    const revenue=data.payments.filter(p=>p.status==='paid').reduce((n,p)=>n+Number(p.amount||0),0);
    const metrics=document.querySelectorAll('#view-reports .metric strong');
    if(metrics[0])metrics[0].textContent=money(revenue);
    if(metrics[1])metrics[1].textContent=data.appointments.length;
    const completed=data.appointments.filter(a=>a.status==='completed').length;
    if(metrics[2])metrics[2].textContent=data.appointments.length?Math.round(completed/data.appointments.length*100)+'%':'0%';
    if(metrics[3])metrics[3].textContent=data.customers.length?Math.round(data.customers.filter(c=>data.appointments.some(a=>a.customer_id===c.id)).length/data.customers.length*100)+'%':'0%';
  }

  function renderRevenue() {
    const revenue=data.payments.filter(p=>p.status==='paid').reduce((n,p)=>n+Number(p.amount||0),0);
    const metrics=document.querySelectorAll('#view-revenue .metric strong');
    if(metrics[0])metrics[0].textContent=money(revenue);
    if(metrics[1])metrics[1].textContent=data.customers.length;
    if(metrics[2])metrics[2].textContent=data.customers.length?money(revenue/data.customers.length):money(0);
    if(metrics[3])metrics[3].textContent=data.customers.length?Math.round(data.payments.filter(p=>p.status==='paid').length/data.customers.length*100)+'%':'0%';
    const table=document.querySelector('#view-revenue table tbody');
    if(table) table.innerHTML=data.payments.slice(0,50).map(p=>`<tr><td>${esc(p.concept||'Cobro')}</td><td>${money(p.amount)}</td><td>${esc(p.method||'')}</td><td><span class="badge ${p.status==='paid'?'confirmed':'pending'}">${esc(p.status)}</span></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No hay pagos registrados.</td></tr>';
  }

  function renderSettings() {
    const name=$('setBusiness'); if(name && business) name.value=business.name||'';
    const phone=document.querySelector('#view-settings input[value="+57 300 000 0000"]'); if(phone && business?.phone) phone.value=business.phone;
    const production=document.querySelector('#view-settings .grid3');
    if(production){production.innerHTML=`<div class="card"><b>🗄️ Backend + BD</b><p style="font-size:11px;color:var(--muted)">Supabase operativo y conectado.</p><span class="badge confirmed">Conectado</span></div><div class="card"><b>💬 WhatsApp + IA</b><p style="font-size:11px;color:var(--muted)">Webhook real y asistente IA en producción.</p><span class="badge confirmed">Conectado</span></div><div class="card"><b>🔐 Seguridad</b><p style="font-size:11px;color:var(--muted)">Sesiones, RLS y funciones protegidas.</p><span class="badge confirmed">Activo</span></div>`;}
  }

  function renderAll(){ removeDemoSurface(); renderDashboard(); renderClients(); renderAgenda(); renderConversations(); renderMarketing(); renderReports(); renderRevenue(); renderSettings(); }

  window.runAI = async () => {
    try {
      const q = $('aiInput')?.value?.trim() || 'Analiza el negocio y dame la principal oportunidad de crecimiento.';
      const { data: answer, error } = await client.functions.invoke('citabot-ai', { body: { name: business?.name || 'negocio', question: q } });
      if (error) throw error;
      $('aiAnswer').textContent = answer?.text || answer?.message || 'No se obtuvo una respuesta.';
    } catch (e) { toast(e.message || 'No se pudo consultar la IA'); }
  };
  window.askAI = window.runAI;
  window.enterDemo = () => toast('El modo demo está deshabilitado en producción.');
  window.confirmModal = async () => {
    try {
      const type = window.state?.modalType || '';
      if (!business) throw new Error('Primero inicia sesión.');
      if (type === 'Nuevo cliente') {
        const name=$('mName')?.value?.trim(); if(!name) throw new Error('El nombre es obligatorio.');
        const {error}=await client.from('customers').insert({business_id:business.id,name,phone:$('mPhone')?.value?.trim()||null,email:$('mEmail')?.value?.trim()||null}); if(error) throw error;
      } else if (type === 'Nuevo servicio' || type === '+ Servicio') {
        const name=$('mName')?.value?.trim(); const duration=Number($('mDuration')?.value); const price=Number($('mPrice')?.value);
        if(!name) throw new Error('El nombre es obligatorio.'); if(duration<5||duration>1440) throw new Error('Duración inválida.'); if(price<0) throw new Error('Precio inválido.');
        const {error}=await client.from('services').insert({business_id:business.id,name,duration_minutes:duration,price,active:true}); if(error) throw error;
      } else if (type === 'Nueva cita' || type === 'Nueva reserva') {
        const customer=$('mCustomer')?.value, service=$('mService')?.value, staff=$('mStaff')?.value, start=$('mStart')?.value;
        if(!customer||!service||!staff||!start) throw new Error('Completa cliente, servicio, profesional y fecha.');
        const svc=data.services.find(s=>s.id===service); const dt=new Date(start); if(!svc||Number.isNaN(dt.getTime())||dt<=new Date()) throw new Error('Fecha o servicio inválido.');
        const {error}=await client.from('appointments').insert({business_id:business.id,customer_id:customer,service_id:service,staff_id:staff,starts_at:dt.toISOString(),ends_at:new Date(dt.getTime()+Number(svc.duration_minutes)*60000).toISOString(),status:'confirmed'}); if(error) throw error;
      } else if (type === 'Nuevo cobro') {
        const amount=Number($('mPrice')?.value || $('mAmount')?.value || 0); if(amount<=0) throw new Error('Valor inválido.');
        const {error}=await client.from('payments').insert({business_id:business.id,amount,currency:'COP',method:$('mMethod')?.value||'manual',concept:$('mConcept')?.value||'Cobro',status:'paid'}); if(error) throw error;
      } else { toast('Esta acción requiere configuración externa.'); if(window.closeModal) window.closeModal(); return; }
      if(window.closeModal) window.closeModal(); await load(); toast(type+' guardado correctamente.');
    } catch(e) { toast(e.message || 'No se pudo guardar.'); }
  };
  window.saveSettings = async () => {
    if(!business) return toast('Primero inicia sesión.');
    const name=$('setBusiness')?.value?.trim(); if(!name) return toast('Escribe el nombre del negocio.');
    const {error}=await client.from('businesses').update({name,phone:document.querySelector('#view-settings input[value="+57 300 000 0000"]')?.value?.trim()||business.phone}).eq('id',business.id);
    if(error) return toast(error.message); business.name=name; $('businessName').textContent=name; toast('Cambios guardados.');
  };

  async function boot(){
    removeDemoSurface();
    try {
      const b=await context();
      if(b){ await load(); document.getElementById('landing')?.classList.remove('active'); document.getElementById('app').style.display='grid'; $('businessName').textContent=b.name; }
    } catch(e){ console.error('CitaBot production runtime',e); }
  }
  client.auth.onAuthStateChange(async (event) => { if(event==='SIGNED_IN'){ await boot(); } if(event==='SIGNED_OUT'){ location.reload(); } });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
