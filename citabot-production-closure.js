// CitaBot production closure: authoritative UI cleanup + real outbound WhatsApp.
(() => {
  'use strict';
  const SUPABASE_URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XjqZnyBiOxC1fLNE9rJxQw_9xzEXquH';
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!client) return;
  const $ = (id) => document.getElementById(id);
  const toast = (m) => window.showToast ? window.showToast(m) : console.log(m);

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
      const business = await getBusiness();
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

  async function syncMetaStatus() {
    try {
      const result = await client.functions.invoke('citabot-meta-sync', { body: {} });
      const ok = !result.error && result.data?.subscribed === true;
      const grid = document.querySelector('#view-settings .grid3');
      if (grid) {
        const card = [...grid.children].find(x => (x.textContent || '').includes('WhatsApp + IA'));
        if (card) {
          const badge = card.querySelector('.badge');
          const p = card.querySelector('p');
          if (ok) { if (badge) { badge.textContent='Conectado'; badge.className='badge confirmed'; } if (p) p.textContent='Meta confirmó la suscripción de WhatsApp.'; }
          else { if (badge) { badge.textContent='Pendiente de verificación'; badge.className='badge pending'; } if (p) p.textContent='La conexión está configurada, pero Meta aún no fue confirmada por la cuenta.'; }
        }
      }
    } catch (e) {
      const grid = document.querySelector('#view-settings .grid3');
      const card = grid && [...grid.children].find(x => (x.textContent || '').includes('WhatsApp + IA'));
      if (card) { const badge = card.querySelector('.badge'); if (badge) { badge.textContent='Pendiente de verificación'; badge.className='badge pending'; } }
    }
  }

  function bootClosure() {
    removeFakeSurface();
    setTimeout(removeFakeSurface, 800);
    setTimeout(syncMetaStatus, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootClosure, { once: true }); else bootClosure();
})();
