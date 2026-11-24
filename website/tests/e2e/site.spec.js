import { expect, test } from "@playwright/test";

test("home tells the product story and leads to downloads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/SYNVOX/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://synvox.pro/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /SYNVOX/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI, который не только отвечает. Он делает.");
  await expect(page.locator(".hero-lockup")).toHaveAttribute("src", "/images/synvox-lockup-transparent.png");
  await expect(page.locator(".wordmark-name")).toHaveAttribute("src", "/images/synvox-wordmark-transparent.png");
  await expect(page.getByRole("link", { name: "Скачать SYNVOX" }).first()).toHaveAttribute("href", "#download");
  await expect(page.locator(".benefit-card")).toHaveCount(3);
  await expect(page.getByText("ChatGPT · Qwen · DeepSeek · Google AI · GLM")).toBeVisible();
  await expect(page.getByText(/остаются на вашем устройстве/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "SYNVOX на вашем компьютере." })).toBeVisible();
  await expect(page.getByText('Бесплатно для личного использования.')).toBeVisible();
  await expect(page.locator('a[href="/downloads/synvox-desktop-0.5.65.zip"]')).toBeVisible();
  await expect(page.locator('a[href="/downloads/synvox-vscode-0.5.65.vsix"]')).toBeVisible();
  await expect(page.locator('a[href="/downloads/synvox-jetbrains-0.5.65.zip"]')).toBeVisible();
});

test("updates route shows the current release and thanks users", async ({ page }) => {
  await page.goto("/updates/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://synvox.pro/updates/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Журнал");
  await expect(page.getByRole("heading", { name: "SYNVOX 0.5.65 — десктопная версия" })).toBeVisible();
  await expect(page.getByText(/SYNVOX теперь распространяется бесплатно/)).toBeVisible();
});

test("documents route publishes the legal bundle and alpha status", async ({ page }) => {
  await page.goto("/documents/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Документы и данные");
  await expect(page.locator('#offer summary')).toContainText("Публичная оферта");
  await expect(page.locator('#privacy summary')).toContainText("Политика обработки персональных данных");
  await expect(page.getByText("Отмена подписки и возвраты", { exact: true })).toBeVisible();
  await expect(page.getByText(/альфа-продукт/i).first()).toBeVisible();
  await expect(page.getByText('Активация, оплата, продление и новые подписки отключены.')).toBeVisible();
  await expect(page.locator('#contacts')).toContainText('121524067747');
  await expect(page.locator('#contacts')).toContainText('г. Мурманск');
  await expect(page.locator('#contacts a[href="mailto:stas.sor@gmail.com"]')).toBeVisible();
  await expect(page.locator('#offer')).toContainText('99 рублей за 30 дней');
  await expect(page.locator('#refunds')).toContainText('SYNVOX — возврат');
  await expect(page.locator('.draft-callout')).toContainText('не являются предложением купить SYNVOX');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("reduced motion disables decorative animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const animationName = await page.locator(".hero-background").evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe("none");
});
