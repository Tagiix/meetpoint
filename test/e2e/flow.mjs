// End-to-end test in a real browser: an organizer and a guest, two separate browser contexts.
//   cd test/e2e && npm install && npm run install-browser && BASE=http://127.0.0.1:8765 npm test
// Exits non-zero when a check fails. Screenshots go to test/e2e/shots/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8765').replace(/\/$/, '') + '/';
mkdirSync('shots', { recursive: true });
let failed = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' (' + extra + ')' : ''}`); if (!cond) failed = 1; };

const browser = await chromium.launch();
const open = async () => {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  return page;
};
const A = await open(), G = await open();
let id;
const event = () => fetch(BASE + 'api/meetup.php?id=' + id).then((r) => r.json());

await A.goto(BASE); await A.waitForSelector('#create');
check('create button is enabled', !(await A.locator('#create').isDisabled()));
await A.click('button[data-opt=objective][data-v=sum]');
await A.fill('#f-title', 'E2E event'); await A.click('#create');
await A.waitForURL(/\?e=/); id = new URL(A.url()).searchParams.get('e');
check('event created', !!id, id);
check('options saved at creation', (await event()).options.objective === 'sum');

// organizer adds a position by clicking on the map
await A.fill('#d-name', 'Organizer'); await A.click('[data-pick=d]'); await A.mouse.click(900, 480);
await A.waitForSelector('.placed'); await A.click('#d-add');
await A.waitForFunction(() => document.querySelector('#count')?.textContent.startsWith('1/'));
check('organizer added a position', (await event()).people.length === 1);

// a guest has no organizer powers, adds their own position
await G.goto(BASE + '?e=' + id); await G.waitForSelector('#d-name');
check('guest does not see the organizer link', (await G.locator('#copy-adm').count()) === 0);
check('guest settings are read-only', await G.locator('button[data-opt=objective]').first().isDisabled());
await G.fill('#d-name', 'Guest'); await G.click('[data-pick=d]'); await G.mouse.click(700, 300);
await G.waitForSelector('.placed'); await G.click('[data-dm=bike]'); await G.click('#d-add');
await G.waitForFunction(() => document.querySelector('#count')?.textContent.startsWith('2/'));
check('guest added a position', (await event()).people.length === 2);

// the organizer sees the guest without reloading (polling), and results appear
await A.waitForFunction(() => document.querySelector('#count')?.textContent.startsWith('2/'), null, { timeout: 25000 });
check('organizer sees the guest by polling', true);
await A.waitForSelector('.res');
check('three ranked results', (await A.locator('.res').count()) === 3);
check('solving runs in a Web Worker', (await A.evaluate(() => window.__meetpointEngine.mode)) === 'worker');
check('animation does not start by itself', (await A.locator('#play').textContent()).trim() === '▶');
await A.click('#play'); await A.waitForTimeout(400);
check('Play starts it', (await A.locator('#play').textContent()).trim() === '❚❚');
await A.click('#play');
await A.screenshot({ path: 'shots/organizer.png' });

// the address dropdown: case, accents and apostrophes are ignored; Tab and arrows walk the list, Enter picks
{
  const f = A.locator('[data-addr=d]').first();
  await f.fill('GARE DE LEST'); await A.waitForTimeout(400);
  check('station search ignores case and apostrophes', /Gare de l'Est/.test((await A.locator('.suggest li').allTextContents()).join('|')));
  await f.fill(''); await f.type('nation', { delay: 20 }); await A.waitForTimeout(600);
  await A.keyboard.press('Tab'); await A.keyboard.press('Tab');
  check('Tab walks down the dropdown', (await A.locator('.suggest li.on').count()) === 1 && /Nationale/.test(await A.locator('.suggest li.on').textContent()));
  await f.fill('');
}
// the organizer edits the guest's address through the station search, and gives themself a different way back
await A.locator('.person[data-pid]').nth(1).locator('[data-act=edit]').click();
check('organizer can edit someone else', (await A.locator('.more').count()) === 1);
await A.locator('.more [data-stn]').first().fill('nation');
await A.locator('.more .suggest li').first().click();
await A.waitForTimeout(1200);
const guest = (await event()).people[1];
check('guest address set from a station', /Nation/i.test(guest.addr) && Math.abs(guest.lat - 48.848) < 0.01, guest.addr);
await A.locator('.person[data-pid]').nth(1).locator('[data-act=edit]').click();
await A.locator('.person[data-pid]').nth(0).locator('[data-act=edit]').click();
await A.locator('.more [data-retsw]').check();
await A.locator('.more [data-stn=r\\:' + (await event()).people[0].id + ']').fill('gare de lyon');
await A.locator('.more .suggest li').first().click();
await A.waitForTimeout(1200);
const org = (await event()).people[0];
check('organizer has a different way back', org.ret && /Lyon/i.test(org.ret.addr), org.ret && org.ret.addr);
await A.waitForFunction(() => /↩/.test(document.querySelector('.res')?.textContent || ''));
check('result cards show the way back', true);
await A.locator('.person[data-pid]').nth(0).locator('[data-act=edit]').click();

// organizer changes a setting; guest edits their own entry; organizer removes the guest
await A.click('button[data-opt=objective][data-v=balanced]'); await A.waitForTimeout(1000);
check('organizer setting saved', (await event()).options.objective === 'balanced');
await G.click('[data-act=edit]'); await G.fill('.more [data-f=name]', 'Guest Renamed'); await G.locator('.more [data-f=name]').blur();
await G.waitForTimeout(1000);
check('guest renamed their own entry', (await event()).people.some((p) => p.name === 'Guest Renamed'));
await A.click('[data-act=remove]'); await A.waitForTimeout(1200);
check('organizer removed the guest', (await event()).people.length === 1);

// an update installed while the page is open: the page reloads itself (we fake one by touching a file)
import { utimesSync, existsSync } from 'node:fs';
const css = new URL('../../assets/style.css', import.meta.url).pathname;
if (existsSync(css)) {
  const before = await A.evaluate(() => window.MP_BUILD);
  const now = new Date(); utimesSync(css, now, new Date(now.getTime() + 5000 + Math.floor(Math.random() * 1000)));
  await A.evaluate(() => { window.__marker = 1; });
  await A.evaluate(() => window.__meetpointCheckUpdate());
  await A.waitForFunction(() => window.__marker === undefined, null, { timeout: 15000 }).catch(() => {});
  await A.waitForSelector('#copy-adm', { timeout: 15000 });
  check('page reloads itself after an update', (await A.evaluate(() => window.MP_BUILD)) !== before);
}

// "Reload everything" refetches the app and keeps the organizer's keys
await A.click('#hard-reload'); await A.waitForSelector('#copy-adm', { timeout: 20000 });
check('still organizer after a full reload', (await A.locator('#copy-adm').count()) === 1);

// clean up: delete the event with the organizer key the browser stored
const adminKey = await A.evaluate((i) => JSON.parse(localStorage.getItem('meetpoint:v2')).events[i].admin, id);
const del = await fetch(BASE + 'api/meetup.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id, adminKey }) }).then((r) => r.json());
check('test event deleted', del.ok === true);
await browser.close();
console.log(failed ? 'FAILED' : 'ALL PASSED'); process.exit(failed);
