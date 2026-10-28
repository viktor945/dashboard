const { chromium } = require('playwright');
const assert = require('assert/strict');
const BASE = process.env.PORYADOK_TEST_URL || 'http://127.0.0.1:8014/';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.PORYADOK_CONFIG={};' }));
    await page.goto(BASE);
    const categories = [{ id: 'inbox', name: 'Общие задачи' }, { id: 'personal', name: 'Личное', workspace: 'personal' },
      ...Array.from({ length: 30 }, (_, i) => ({ id: 'b' + i, name: 'Бренд ' + String(i).padStart(2, '0') }))];
    const tasks = [['todo', 'Купить образцы', 'todo'], ['progress', 'Согласовать презентацию', 'progress'], ['done', 'Отправлено', 'done']].map(([id, title, status]) => ({
      id, title, status, category: 'b0', priority: 'medium', source: 'self', due: '', description: 'Синтетическая задача', link: '',
      history: [{ at: '2026-10-01T12:00:00Z', kind: 'note', text: 'Исходная заметка' }]
    }));
    await page.evaluate(value => localStorage.setItem('poryadok.tasks.v1', JSON.stringify(value)), { version: 1, categories, tasks });
    await page.reload();
    await page.locator('[data-brand=b27]').scrollIntoViewIfNeeded();
    const previousScroll = await page.evaluate(() => scrollY);
    assert(previousScroll > 1000);
    await page.locator('[data-brand=b27]').click();
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(await page.locator('#brand-overview').isVisible(), false);
    assert.match(await page.locator('#brand-detail-heading').innerText(), /Бренд 27/);
    await page.locator('#header-back-portfolio').click();
    assert(Math.abs(await page.evaluate(() => scrollY) - previousScroll) <= 2);
    assert.equal(await page.locator('#brand-overview').isVisible(), true);
    await page.locator('[data-brand=b0]').click();
    await page.locator('[data-layout=board]').click();
    assert.equal(await page.locator('.kanban-column').count(), 4);
    assert.equal(await page.locator('.task-card').count(), 2);
    await page.locator('[data-task-status=todo]').selectOption('waiting');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('poryadok.tasks.v1')).tasks.find(t => t.id === 'todo').status === 'waiting');
    assert.equal(await page.locator('[data-column=waiting] [data-task=todo]').count(), 1);
    await page.locator('[data-task=progress]').dragTo(page.locator('[data-column=todo] .kanban-heading'));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('poryadok.tasks.v1')).tasks.find(t => t.id === 'progress').status === 'todo');
    page.once('dialog', d => d.dismiss());
    await page.locator('[data-task=progress]').dragTo(page.locator('[data-column=done] .kanban-heading'));
    assert.equal(await page.locator('[data-column=todo] [data-task=progress]').count(), 1);
    page.once('dialog', d => d.accept());
    await page.locator('[data-task=progress]').dragTo(page.locator('[data-column=done] .kanban-heading'));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('poryadok.tasks.v1')).tasks.find(t => t.id === 'progress').status === 'done');
    await page.locator('#show-completed').check();
    assert.equal(await page.locator('[data-column=done] .task-card').count(), 2);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('poryadok.tasks.v1')));
    const changed = stored.tasks.find(t => t.id === 'progress');
    assert.equal(changed.history[0].text, 'Исходная заметка');
    assert.deepEqual(changed.history.filter(h => h.eventType === 'status').map(h => h.toStatus), ['todo', 'done']);
    await page.locator('[data-layout=list]').click();
    assert.match(await page.locator('#brand-detail-heading').innerText(), /Бренд 00/);
    assert.equal(await page.locator('.task-card').count(), 3);
    await page.locator('[data-layout=board]').click();
    await page.reload();
    assert.equal(await page.locator('[data-layout=board]').getAttribute('aria-pressed'), 'true');
    await page.locator('#data-tools').click();
    assert.equal(await page.locator('#export-csv').isVisible(), false);
    assert.equal(await page.locator('#download-template').isVisible(), true);
    assert.equal(await page.locator('#data-import-report').isVisible(), true);
    assert.equal(await page.locator('#open-work-report').isVisible(), true);
    await page.locator('#data-additional > summary').click();
    assert.equal(await page.locator('#export-csv').isVisible(), true);
    await page.locator('#close-data').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.locator('.kanban-board').evaluate(el => el.scrollWidth > el.clientWidth));
    await page.locator('[data-view=all]').click();
    await page.locator('[data-brand=b29]').click();
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('#new-task').isVisible(), true);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const back = await page.locator('#header-back-portfolio').boundingBox();
    assert(back.y >= 0 && back.y < 844);
    assert.deepEqual(errors, []);
    console.log('PASS: separate brand screen, portfolio scroll restoration, board/list context, drag/drop and keyboard status control, completion confirmation/cancel, history and layout persistence, simplified file menu, mobile board scrolling confined to board.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
