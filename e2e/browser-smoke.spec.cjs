const { test, expect } = require('playwright/test');

const BASE_URL = process.env.BASE_URL || 'https://servicerca.github.io/Citabot-/';

test.describe('CitaBot production browser smoke', () => {
  test('landing, directory, legal and auth UI', async ({ page }) => {
    const consoleErrors = [];
    const serverErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('response', response => {
      if (response.status() >= 500) {
        serverErrors.push({ status: response.status(), url: response.url() });
      }
    });

    const response = await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    expect(response && response.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/CitaBot/i);
    await expect(page.locator('#landing')).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: /Comenzar gratis/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Explorar negocios/i })).toHaveCount(1);

    await page.getByRole('button', { name: /Explorar negocios/i }).click();
    await expect(page.locator('#directoryModal')).toHaveClass(/open/);
    await expect(page.locator('#directorySearch')).toBeVisible();
    await expect(page.locator('#directoryResults')).toContainText(/negocios|resultados|Cargando/i);
    await page.locator('#directoryModal .close').click();

    await expect(page.locator('#navPlatformAdmin')).toBeHidden();
    await expect(page.locator('#view-dashboard')).not.toHaveClass(/active/);
    await expect(page.locator('#view-platform-admin')).not.toHaveClass(/active/);

    await page.getByRole('button', { name: /Comenzar gratis/i }).first().click();
    await expect(page.locator('#cbAuth')).toHaveClass(/open/);
    await expect(page.locator('#cbAuthTitle')).toHaveText('Crear cuenta en CitaBot');
    await expect(page.locator('#cbAuthName')).toBeVisible();
    await expect(page.locator('#cbAuthEmail')).toBeVisible();
    await expect(page.locator('#cbAuthPassword')).toBeVisible();
    await expect(page.locator('#cbAuthConsent')).toBeVisible();
    await page.locator('#cbAuthConsentWrap').getByRole('button', { name: /Términos de servicio/i }).click();
    await expect(page.locator('#legalModal')).toHaveClass(/open/);
    await expect(page.locator('#legalBody')).toContainText(/Términos de servicio/i);
    await page.locator('#legalModal .close').click();

    await page.getByRole('button', { name: /Ya tengo una cuenta/i }).click();
    await expect(page.locator('#cbAuthTitle')).toHaveText('Iniciar sesión');
    await expect(page.locator('#cbAuthForgot')).toBeVisible();
    await page.getByRole('button', { name: /Olvidé mi contraseña/i }).click();
    await expect(page.locator('#cbAuthMsg')).toContainText(/Escribe primero tu correo/i);
    await page.locator('#cbAuthEmail').fill('');
    await page.getByRole('button', { name: /Cancelar/i }).click();

    // The public session must safely reject the admin route without a scope ReferenceError.
    await page.evaluate(() => go('platform-admin'));
    await expect(page.locator('#navPlatformAdmin')).toBeHidden();
    await expect(page.locator('#view-platform-admin')).not.toHaveClass(/active/);

    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('public booking sends payment method to the real backend contract', async ({ page }) => {
    let submittedBody = null;

    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/functions/v1/citabot-public-booking')
      ) {
        submittedBody = request.postDataJSON();
      }
    });

    const response = await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    expect(response && response.ok()).toBeTruthy();

    await page.evaluate(() => {
      const fields = [
        ['select', 'pbService', '00000000-0000-4000-8000-000000000002'],
        ['select', 'pbStaff', '00000000-0000-4000-8000-000000000003'],
        ['input', 'pbDate', ''],
        ['input', 'pbTime', '10:00'],
        ['input', 'pbName', 'Cliente E2E'],
        ['input', 'pbPhone', '+573001112233'],
        ['input', 'pbEmail', 'cliente-e2e@example.invalid'],
        ['select', 'pbPaymentMethod', 'transfer'],
        ['textarea', 'pbNote', ''],
      ];

      for (const [tag, id, value] of fields) {
        const el = document.createElement(tag);
        el.id = id;
        if (value) el.value = value;
        if (tag === 'select') {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          el.appendChild(option);
        }
        document.body.appendChild(el);
      }

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      document.getElementById('pbDate').value = tomorrow;

      for (const [id, checked] of [['pbPrivacy', true], ['pbWhatsapp', true]]) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = id;
        box.checked = checked;
        document.body.appendChild(box);
      }

      const msg = document.createElement('div');
      msg.id = 'pbMsg';
      document.body.appendChild(msg);
    });

    await page.evaluate(async () => {
      await window.cbBookSubmit('__invalid_slug_for_real_ci__', 'America/Bogota');
    });

    expect(submittedBody).toBeTruthy();
    expect(submittedBody.business_slug).toBe('__invalid_slug_for_real_ci__');
    expect(submittedBody.payment_method).toBe('transfer');
    expect(submittedBody.privacy_consent).toBe(true);
    expect(submittedBody.whatsapp_consent).toBe(true);

    const backendResponse = await page.request.post(
      'https://rphyhaoxwvaezulvhcrf.supabase.co/functions/v1/citabot-public-booking',
      {
        headers: {
          apikey: process.env.SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        data: submittedBody,
      }
    );

    expect(backendResponse.status()).toBe(400);
    await expect(page.locator('#pbMsg')).not.toContainText(/reserva confirmada/i);
  });

  test('simplified workspace navigation works at mobile, tablet and desktop widths', async ({ page }) => {
    const response = await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    expect(response && response.ok()).toBeTruthy();

    // Reveal only the already-rendered workspace shell. No login is forged and no API is mocked.
    await page.evaluate(() => {
      document.getElementById('landing')?.classList.remove('active');
      const app = document.getElementById('app');
      if (app) app.style.display = 'grid';
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const nav = page.locator('#app nav[aria-label="Navegación principal"]');
    const more = page.locator('#navMoreToggle');
    const menu = page.locator('#navMoreMenu');
    await expect(nav).toBeVisible();
    for (const view of ['dashboard', 'agenda', 'clients', 'conversations']) {
      await expect(page.locator('.nav button[data-view="' + view + '"]')).toBeVisible();
    }
    await expect(more).toBeVisible();
    expect(await nav.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(5);

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await page.getByRole('button', { name: 'Reportes' }).click();
    await expect(page.locator('#view-reports')).toHaveClass(/active/);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    await more.click();
    await page.locator('#crumb').click();
    await expect(menu).toBeHidden();

    await page.locator('.nav button[data-view="conversations"]').click();
    await expect(page.locator('#view-conversations h1')).toHaveText('Mensajes');
    await expect(page.locator('#crumb')).toHaveText('Mensajes');

    // Tablet: retain readable labels rather than an icon-only navigation rail.
    await page.setViewportSize({ width: 800, height: 900 });
    const sidebarWidth = await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width);
    expect(sidebarWidth).toBeGreaterThanOrEqual(200);
    const agendaLabelDisplay = await page.locator('.nav button[data-view="agenda"] span:last-child')
      .evaluate(el => getComputedStyle(el).display);
    expect(agendaLabelDisplay).not.toBe('none');
    await expect(more).toBeVisible();

    // Desktop: retain the full sidebar and keep the platform-admin route denied.
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktopSidebarWidth = await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width);
    expect(desktopSidebarWidth).toBeGreaterThanOrEqual(240);
    await page.evaluate(() => go('platform-admin'));
    await expect(page.locator('#view-platform-admin')).not.toHaveClass(/active/);
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/);
  });
});