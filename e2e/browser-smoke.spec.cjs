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

    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('public booking sends payment method to the real backend contract', async ({ page }) => {
    let submittedBody = null;
    let bookingStatus = null;

    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/functions/v1/citabot-public-booking')
      ) {
        submittedBody = request.postDataJSON();
      }
    });

    page.on('response', response => {
      if (
        response.request().method() === 'POST' &&
        response.url().includes('/functions/v1/citabot-public-booking')
      ) {
        bookingStatus = response.status();
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
    expect(bookingStatus).toBe(400);
    await expect(page.locator('#pbMsg')).not.toContainText(/reserva confirmada/i);
  });});
