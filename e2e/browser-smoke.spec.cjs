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

    await page.getByRole('button', { name: /Explorar negocios/i }).first().click();
    await expect(page.locator('#directoryModal')).toHaveClass(/open/);
    await expect(page.locator('#directorySearch')).toBeVisible();
    await expect(page.locator('#directoryResults')).toContainText(/negocios|resultados|Cargando/i);
    await page.locator('#directoryModal .close').click();

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

  test('public booking captures payment method', async ({ page }) => {
    let submittedBody = null;

    await page.route('**/functions/v1/citabot-public-booking**', async route => {
      const request = route.request();
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: {
              business: {
                id: '00000000-0000-4000-8000-000000000001',
                name: 'Negocio E2E',
                slug: 'negocio-e2e',
                city: 'Santa Marta',
                address: 'Calle 1',
                timezone: 'America/Bogota',
                whatsapp: '+573000000000',
                latitude: null,
                longitude: null,
                description: 'Agenda E2E',
              },
              services: [{
                id: '00000000-0000-4000-8000-000000000002',
                name: 'Servicio E2E',
                description: '',
                duration_minutes: 30,
                price: 50000,
              }],
              staff: [{
                id: '00000000-0000-4000-8000-000000000003',
                name: 'Profesional E2E',
              }],
              hours: [{
                day_of_week: 0,
                opens_at: '09:00:00',
                closes_at: '18:00:00',
                closed: false,
              }],
            },
          }),
        });
      }

      submittedBody = request.postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, appointment_id: '00000000-0000-4000-8000-000000000004' }),
      });
    });

    const response = await page.goto(BASE_URL + '?book=negocio-e2e', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    expect(response && response.ok()).toBeTruthy();

    await expect(page.locator('#pbPaymentMethod')).toBeVisible();
    await expect(page.locator('#pbPaymentMethod option')).toHaveCount(4);
    await expect(page.locator('#pbPaymentMethod option[value="cash"]')).toHaveText('Efectivo');
    await expect(page.locator('#pbPaymentMethod option[value="transfer"]')).toHaveText('Transferencia');
    await expect(page.locator('#pbPaymentMethod option[value="other"]')).toHaveText('Otro');

    const tomorrow = await page.evaluate(() => {
      const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
      return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    });
    await page.locator('#pbPaymentMethod').selectOption('transfer');
    await page.locator('#pbDate').fill(tomorrow);
    await page.locator('#pbTime').fill('10:00');
    await page.locator('#pbName').fill('Cliente E2E');
    await page.locator('#pbPhone').fill('+573001112233');
    await page.locator('#pbEmail').fill('cliente-e2e@example.invalid');
    await page.locator('#pbPrivacy').check();
    await page.locator('#pbWhatsapp').check();
    await page.locator('#pbSubmit').click();

    await expect(page.locator('#pbMsg')).toContainText(/reserva confirmada/i);
    expect(submittedBody).toBeTruthy();
    expect(submittedBody.payment_method).toBe('transfer');
    expect(submittedBody.business_slug).toBe('negocio-e2e');
    expect(submittedBody.privacy_consent).toBe(true);
    expect(submittedBody.whatsapp_consent).toBe(true);
  });
});
