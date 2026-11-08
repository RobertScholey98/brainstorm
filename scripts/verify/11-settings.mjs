// Settings in the Electron app: the sidebar foot's Settings and update buttons, the dialog's pages and search, a theme
// that reaches the native theme and the page, a setting that survives a restart, and Restore defaults.
//
//   node scripts/verify/11-settings.mjs
import { join } from "node:path";
import { build, checks, launch, settled, workspace } from "./electron.mjs";

const { check, finish } = checks();
build();
const { home, shots, env } = workspace("settings");

// Playwright pins the page to a light colour scheme; the theme check needs the page to follow the native theme.
const real = async (w) => w.emulateMedia({ colorScheme: null });
let { app, window, errors } = await launch(home, env);
await real(window);
await window.waitForSelector("[data-settings-open]");
const foot = window.locator('[data-sidebar="footer"]');
await foot.screenshot({ path: join(shots, "01-foot.png") });
check("the foot holds Settings and the update button", await foot.locator("[data-settings-open]").textContent(), "Settings");
// A build run from source can't update itself, so its update button is off and says why.
check("a source build's update button is off", await window.locator("[data-update-button] button").isDisabled(), true);

await window.click("[data-settings-open]");
await window.waitForSelector("[data-settings]");
await window.screenshot({ path: join(shots, "02-general.png") });
const pages = await window.locator("[data-settings-page]").evaluateAll((els) => els.map((e) => e.getAttribute("data-settings-page")));
check("the nav lists every page", pages, ["general", "appearance", "canvas", "preview", "agent", "files", "updates", "shortcuts"]);

for (const page of pages) {
  await window.click(`[data-settings-page="${page}"]`);
  await window.screenshot({ path: join(shots, `03-${page}.png`) });
}

// Dark theme reaches Electron's native theme, so the page's prefers-color-scheme follows it.
await window.click('[data-settings-page="appearance"]');
await window.click('[data-theme="dark"]');
await window.waitForFunction(() => matchMedia("(prefers-color-scheme: dark)").matches);
check("the native theme follows the setting", await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), "dark");
await window.screenshot({ path: join(shots, "04-dark.png") });

// Search lists every row it finds under its page, and says so when nothing matches.
await window.fill("[data-settings-search]", "skill");
const found = await window.locator("[data-setting]").evaluateAll((els) => els.map((e) => e.getAttribute("data-setting")));
check("search finds the skill's rows", found, ["skill"]);
await window.screenshot({ path: join(shots, "05-search.png") });
await window.fill("[data-settings-search]", "zebra");
check("a search that finds nothing says so", await window.locator("[data-settings-body]").textContent(), 'No settings matchNothing here mentions zebra.');
await window.fill("[data-settings-search]", "");

await window.click('[data-settings-page="canvas"]');
await window.click('[data-canvas-view="board"]');
await window.keyboard.press("Escape");
await window.waitForSelector("[data-settings]", { state: "detached" });
check("no console errors or warnings", errors, []);
await app.close();

// The choices survive a restart, Ctrl+, opens Settings, and Restore defaults puts them back.
({ app, window, errors } = await launch(home, env));
await real(window);
await window.waitForSelector("[data-settings-open]");
check("the theme survives a restart", await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), "dark");
await window.keyboard.press("Control+,");
await window.waitForSelector("[data-settings]");
await window.click('[data-settings-page="canvas"]');
check("the canvas view survives a restart", await window.locator('[data-canvas-view="board"]').getAttribute("aria-pressed"), "true");
await window.click("[data-settings-restore]");
check("Restore defaults puts the theme back", await settled(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)), "system");
check("Restore defaults puts the view back", await window.locator('[data-canvas-view="stage"]').getAttribute("aria-pressed"), "true");
check("no console errors or warnings after the restart", errors, []);
await app.close();
finish();
