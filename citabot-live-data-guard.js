// CITABOT_LIVE_DATA_GUARD_V1
(() => {
  'use strict';
  const URL = 'https://rphyhaoxwvaezulvhcrf.supabase.co';
  const KEY = 'sb_publishable_XjqZnyBiOxC1fLNE9rJxQw_9xzEXquH';

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }
  function money(v) {
    return '$' + Math.round(Number(v || 0)).toLocaleString('es-CO') + ' COP';
  }
  function statusLabel(status) {
    const map = { confirmed: 'Confirmada', pending: 'Pendiente', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asistió' };
    return map[status] || status || 'Pendiente';
  }

  async function run() {
    const client = window.supabase?.createClient(URL, KEY);
    if (!client) return;
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const { data: members, error: me } = await client.from('business_members').select('business_id').eq('user_id', user.id);
    if (me || !members?.length) return;
    const ids = members.map((m) => m.business_id);
    const { data: businesses, error: be } = await client.from('businesses').select('id,timezone').in('id', ids).eq('is_active', true).limit(1);
    if (be || !businesses?.length) return;
    const business = businesses[0];
    const [appointments, payments, customers] = await Promise.all([
      client.from('appointments').select('*,customers(name),services(name,price),staff(name)').eq('business_id', business.id).order('starts_at', { ascending: true }),
      client.from('payments').select('*').eq('business_id', business.id),
      client.from('customers').select('*').eq('business_id', business.id)
    ]);
    if (appointments.error || payments.error || customers.error) return;
    const ap = appointments.data || [];
    const pay = payments.data || [];
    const cust = customers.data || [];
    const tz = business.timezone || 'America/Bogota';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const todayAp = ap.filter(a => a.starts_at && a.starts_at.slice(0, 10) === today && !['cancelled','no_show'].includes(a.status));
    const paid = pay.filter(p => p.status === 'paid');
    const revenue = paid.reduce((n, p) => n + Number(p.amount || 0), 0);
    const last30 = Date.now() - 30 * 864e5;
    const recent = ap.filter(a => new Date(a.starts_at).getTime() >= last30 && !['cancelled','no_show'].includes(a.status));

    // Remove every hard-coded dashboard activity row and rebuild it from Supabase.
    const table = document.querySelector('#view-dashboard .table tbody');
    if (table) {
      table.innerHTML = todayAp.slice(0, 8).map(a => `<tr><td>${new Date(a.starts_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</td><td>${esc(a.customers?.name || 'Cliente')}</td><td>${esc(a.services?.name || 'Servicio')}</td><td><span class="badge ${a.status==='confirmed'?'confirmed':a.status==='completed'?'confirmed':a.status==='cancelled'?'cancelled':'pending'}">${esc(statusLabel(a.status))}</span></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No hay citas para hoy.</td></tr>';
    }

    // Replace fake comparison text and values with real, explainable values.
    document.querySelectorAll('#view-dashboard .trend').forEach(el => {
      if ((el.textContent || '').includes('18%')) el.textContent = 'Datos reales';
    });

    const perfLabel = [...document.querySelectorAll('#view-dashboard *')].find(el => (el.textContent || '').trim() === 'Reservas confirmadas');
    if (perfLabel) {
      const card = perfLabel.closest('.card');
      if (card) {
        const count = recent.length;
        card.innerHTML = `<div class="section-title" style="margin-top:0"><h2>Rendimiento</h2><span>Últimos 30 días</span></div><div class="metric"><small>Reservas confirmadas</small><strong>${count}</strong><span class="trend">Datos reales</span></div>`;
      }
    }

    // Remove remaining obvious demo people if any static node survived elsewhere on Inicio.
    const fakeNames = ['Laura Gómez','Andrés Ruiz','Sofía Pérez','Mateo Díaz'];
    document.querySelectorAll('#view-dashboard *').forEach(el => {
      const t = (el.textContent || '').trim();
      if (fakeNames.some(name => t.includes(name))) el.remove();
    });

    // Keep the live KPI values consistent with the database.
    const metrics = document.querySelectorAll('#view-dashboard .metric strong');
    if (metrics[0]) metrics[0].textContent = todayAp.length;
    if (metrics[1]) metrics[1].textContent = cust.length;
    if (metrics[2]) metrics[2].textContent = money(revenue);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => run().catch(() => {}), { once: true });
  else run().catch(() => {});
})();
