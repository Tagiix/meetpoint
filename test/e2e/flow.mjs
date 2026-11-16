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
await A.fill('#d-name', 'Organizer'); await A.click('#d-pick'); await A.mouse.click(900, 480);
await A.waitForSelector('.placed'); await A.click('#d-add');
await A.waitForFunction(() => document.querySelector('#count')?.textContent.startsWith('1/'));
check('organizer added a position', (await event()).people.length === 1);

// a guest has no organizer powers, adds their own position
await G.goto(BASE + '?e=' + id); await G.waitForSelector('#d-name');
check('guest does not see the organizer link', (await G.locator('#copy-adm').count()) === 0);
check('guest settings are read-only', await G.locator('button[data-opt=objective]').first().isDisabled());
await G.fill('#d-name', 'Guest'); await G.click('#d-pick'); await G.mouse.click(700, 300);
await G.waitForSelector('.placed'); await G.click('[data-dm=bike]'); await G.click('#d-add');
await G.waitForFunction(() => document.querySelector('#count')?.textContent.startsWith('2/'));
check('guest added a position', (await event()).people.length === 2);

// the organizer sees the guest without reloading (polling), and results appear
await A.waitForFunction(() => document.querySelector('#count')?.textContent.startsWith('2/'), null, { timeout: 25000 });
check('organizer sees the guest by polling', true);
await A.waitForSelector('.res');
check('three ranked results', (await A.locator('.res').count()) === 3);
await A.screenshot({ path: 'shots/organizer.png' });

// organizer changes a setting; guest edits their own entry; organizer removes the guest
await A.click('button[data-opt=objective][data-v=balanced]'); await A.waitForTimeout(1000);
check('organizer setting saved', (await event()).options.objective === 'balanced');
await G.click('[data-act=edit]'); await G.fill('.more [data-f=name]', 'Guest Renamed'); await G.locator('.more [data-f=name]').blur();
await G.waitForTimeout(1000);
check('guest renamed their own entry', (await event()).people.some((p) => p.name === 'Guest Renamed'));
await A.click('[data-act=remove]'); await A.waitForTimeout(1200);
check('organizer removed the guest', (await event()).people.length === 1);

// clean up: delete the event with the organizer key the browser stored
const adminKey = await A.evaluate((i) => JSON.parse(localStorage.getItem('meetpoint:v2')).events[i].admin, id);
const del = await fetch(BASE + 'api/meetup.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id, adminKey }) }).then((r) => r.json());
check('test event deleted', del.ok === true);
await browser.close();
console.log(failed ? 'FAILED' : 'ALL PASSED'); process.exit(failed);
