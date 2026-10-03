const { test, expect } = require('playwright/test');

const BASE_URL = process.env.BASE_URL || 'https://servicerca.github.io/Citabot-/';

test.describe('CitaBot production browser smoke', () => {
  test('landing, onboarding, legal, directory and auth UI', async ({ page }) => {
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
    await expect(page.locator('#onboarding')).toHaveClass(/open/);
    await expect(page.locator('#onboardStep')).toContainText(/PASO 1 DE 3/i);

    await page.getByRole('button', { name: /Restaurante/i }).click();
    await expect(page.locator('#onboardStep .choice.selected')).toContainText(/Restaurante/i);

    await page.getByRole('button', { name: /Continuar/i }).click();
    await expect(page.locator('#onboardStep')).toContainText(/PASO 2 DE 3/i);
    await page.locator('#obName').fill('Prueba E2E');
    await page.locator('#obCity').fill('Santa Marta');
    await page.getByRole('button', { name: /Atrás/i }).click();
    await expect(page.locator('#onboardStep')).toContainText(/PASO 1 DE 3/i);

    await page.getByRole('button', { name: /Continuar/i }).click();
    await page.locator('#obName').fill('Prueba E2E');
    await page.locator('#obCity').fill('Santa Marta');
    await page.getByRole('button', { name: /Continuar/i }).click();
    await expect(page.locator('#onboardStep')).toContainText(/PASO 3 DE 3/i);
    await page.locator('#onboarding').press('Escape');
    await expect(page.locator('#onboarding')).not.toHaveClass(/open/);

    await page.getByRole('button', { name: /Comenzar gratis/i }).first().click();
    await expect(page.locator('#cbAuth')).toHaveClass(/open/);
    await expect(page.locator('#cbAuthEmail')).toBeVisible();
    await expect(page.locator('#cbAuthPassword')).toBeVisible();
    await expect(page.locator('#cbAuthConsent')).toBeVisible();
    await expect(page.locator('#cbAuthForgot')).toBeVisible();

    await page.getByRole('button', { name: /Términos de servicio/i }).click();
    await expect(page.locator('#legalModal')).toHaveClass(/open/);
    await expect(page.locator('#legalBody')).toContainText(/Términos de servicio/i);
    await page.locator('#legalModal .close').click();

    await page.getByRole('button', { name: /Ya tengo una cuenta/i }).click();
    await expect(page.locator('#cbAuthTitle')).toHaveText('Iniciar sesión');
    await page.locator('#cbAuthEmail').fill('browser-smoke@example.invalid');
    await page.getByRole('button', { name: /Olvidé mi contraseña/i }).click();
    await expect(page.locator('#cbAuthMsg')).toContainText(/correo/i);
    await page.locator('#cbAuthEmail').fill('');
    await page.getByRole('button', { name: /Cancelar/i }).click();

    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
