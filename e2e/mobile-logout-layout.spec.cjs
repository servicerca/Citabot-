const { test, expect } = require('playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/';

test('mobile and tablet keep the shared logout action visible and unobstructed', async ({ page }) => {
  const response = await page.goto(BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  expect(response && response.ok()).toBeTruthy();

  // The real authenticated workspace is normally shown after sign-in. For this
  // layout-only check, reveal its existing markup without creating a session,
  // mocking a backend, or invoking the logout handler.
  await page.locator('#app').evaluate(element => {
    element.style.display = 'grid';
  });

  // Scope this locator to the mobile-only top-bar control. The desktop sidebar
  // has a different button with the same accessible label.
  const mobileLogout = page.locator('.cb-mobile-logout');
  const desktopLogout = page.locator('.side-bottom button');

  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(mobileLogout).toBeVisible();
    await expect(desktopLogout).toBeHidden();
    expect(await mobileLogout.getAttribute('aria-label')).toBe('Cerrar sesión');

    const buttonBox = await mobileLogout.boundingBox();
    const avatarBox = await page.locator('.top-actions .avatar').boundingBox();

    expect(buttonBox).toBeTruthy();
    expect(avatarBox).toBeTruthy();
    expect(buttonBox.height).toBeGreaterThanOrEqual(38);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(avatarBox.x);
    expect(await mobileLogout.getAttribute('onclick')).toBe('logout()');
    expect(await page.evaluate(() => typeof window.logout)).toBe('function');
    expect(await page.locator('#app').evaluate(element => element.scrollWidth <= window.innerWidth)).toBeTruthy();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(mobileLogout).toBeHidden();
  await expect(desktopLogout).toBeVisible();
});
