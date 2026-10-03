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
    await page.getByRole('button', { name: /Términos de servicio/i }).click();
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
});
