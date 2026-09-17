(() => {
  'use strict';
  const SUPABASE_URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XjqZnyBiOxC1FNE9rJxQw_9xzEXquH';
  const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!sb) return;

  const money = n => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO') + ' COP';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = m => window.showToast ? window.showToast(m) : console.log(m);

  async function getBusiness() {
    const { data: { user }, error: ue } = await sb.auth.getUser();
    if (ue) throw ue;
    if (!user) throw new Error('Inicia sesión para gestionar tu suscripción.');
    const { data: members, error: me } = await sb.from('business_members').select('business_id,role').eq('user_id', user.id);
    if (me) throw me;
    const member = (members || []).find(x => ['owner','admin'].includes(x.role));
    if (!member) throw new Error('No tienes permisos para gestionar la suscripción.');
    const { data: business, error: be } = await sb.from('businesses').select('id,name').eq('id', member.business_id).eq('is_active', true).single();
    if (be) throw be;
    return business;
  }

  function statusLabel(status) {
    return ({trialing:'Pendiente de activación',active:'Activa',past_due:'Pago pendiente',paused:'Pausada',cancelled:'Cancelada'})[status] || 'Sin suscripción';
  }

  async function loadBilling() {
    const view = document.getElementById('view-revenue');
    if (!view) return;
    try {
      const business = await getBusiness();
      const [{ data: subscription, error: se }, { data: payments, error: pe }] = await Promise.all([
        sb.from('subscriptions').select('plan,status,current_period_end,provider,provider_subscription_id,updated_at').eq('business_id', business.id).maybeSingle(),
        sb.from('payments').select('amount,currency,method,concept,status,provider_transaction_id,created_at').eq('business_id', business.id).order('created_at',{ascending:false}).limit(10)
      ]);
      if (se) throw se;
      if (pe) throw pe;

      const active = subscription?.status === 'active';
      const paymentRows = (payments || []).map(p => `<tr><td>${esc(new Date(p.created_at).toLocaleString('es-CO'))}</td><td>${esc(p.concept || 'Pago')}</td><td>${money(p.amount)}</td><td><span class="badge ${p.status==='paid'?'confirmed':p.status==='failed'?'cancelled':'pending'}">${esc(p.status)}</span></td></tr>`).join('');
      const period = subscription?.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString('es-CO') : '—';

      view.innerHTML = `<div class="page-head"><div><h1>Ingresos</h1><p>Suscripción y cobros reales de ${esc(business.name)}.</p></div></div>
        <div class="grid2">
          <div class="card"><small style="color:var(--muted)">Plan actual</small><h2 style="margin:8px 0">${subscription?.plan === 'professional' ? 'Profesional' : subscription?.plan || 'Sin plan'}</h2><p style="font-size:12px;color:var(--muted)">${active ? 'Suscripción activa en Mercado Pago.' : 'La suscripción todavía no está activa.'}</p><span class="badge ${active?'confirmed':'pending'}">${statusLabel(subscription?.status)}</span><p style="font-size:11px;color:var(--muted)">Próximo período: ${period}</p></div>
          <div class="card"><b style="font-size:14px">CitaBot Profesional</b><p style="font-size:12px;color:var(--muted)">Suscripción mensual de ${money(59900)}. El checkout y los cobros recurrentes se procesan en Mercado Pago.</p><button id="cbMpSubscribe" class="btn primary" ${active?'disabled':''}>${active?'Suscripción activa':'Activar con Mercado Pago'}</button><div id="cbMpMsg" style="margin-top:10px;font-size:11px;color:var(--muted)"></div></div>
        </div>
        <div class="section-title"><h2>Pagos registrados</h2><span>Datos reales</span></div>
        <div class="card"><div style="overflow:auto"><table class="table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Valor</th><th>Estado</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="4" class="empty">Todavía no hay pagos registrados.</td></tr>'}</tbody></table></div></div>`;

      document.getElementById('cbMpSubscribe')?.addEventListener('click', async () => {
        const button = document.getElementById('cbMpSubscribe');
        const msg = document.getElementById('cbMpMsg');
        button.disabled = true;
        msg.textContent = 'Preparando checkout seguro…';
        try {
          const { data: { session } } = await sb.auth.getSession();
          if (!session?.access_token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
          const { data, error } = await sb.functions.invoke('citabot-mercadopago-subscribe', { body: { business_id: business.id, plan: 'professional' }, headers: { Authorization: `Bearer ${session.access_token}` } });
          if (error) throw error;
          if (!data?.ok) throw new Error(data?.error || 'Mercado Pago no pudo preparar la suscripción.');
          if (data.already_active) { toast('La suscripción ya está activa.'); await loadBilling(); return; }
          if (!data.init_point) throw new Error('Mercado Pago no devolvió el enlace de checkout.');
          msg.textContent = 'Redirigiendo a Mercado Pago…';
          window.location.href = data.init_point;
        } catch (e) {
          button.disabled = false;
          msg.textContent = e?.message || 'No fue posible iniciar el checkout.';
          toast(msg.textContent);
        }
      });
    } catch (e) {
      view.innerHTML = `<div class="card"><h2>Ingresos</h2><p class="empty">${esc(e?.message || 'No fue posible cargar la facturación real.')}</p></div>`;
    }
  }

  window.citaBotLoadBilling = loadBilling;
  const originalGo = window.go;
  window.go = function(view) {
    const result = originalGo ? originalGo.apply(this, arguments) : undefined;
    if (view === 'revenue') setTimeout(loadBilling, 0);
    return result;
  };
  window.addEventListener('load', () => { if (document.getElementById('view-revenue')?.classList.contains('active')) loadBilling(); });
})();
