// Walkthrough and checks for prototype P6. Usage: PROTO_URL=file://… SHOTS=<dir> node run6.mjs  (needs a Chrome with --remote-debugging-port=9351)
import { createRequire } from 'module';
const require = createRequire('<任意装有 playwright-core 的 node_modules>/');
const { chromium } = require('playwright-core');
const FILE = process.env.PROTO_URL; const SHOTS = process.env.SHOTS;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9351');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage(); await page.setViewportSize({ width: 1440, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(FILE); await page.waitForSelector('#pbar .brand');
const R = { walk: [] }; const fails = []; let checks = 0;
const ok = (name, cond, extra) => { checks++; if (!cond) fails.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 220) : '')); };
const click = (sel) => page.locator(sel).first().click();
const txt = (sel) => page.locator(sel).first().innerText();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, note) => { await page.screenshot({ path: `${SHOTS}/p6-${name}.png` }); R.walk.push([name, note]); };
const sid = () => page.evaluate(() => teamSteps()[S.team.i].id);
const feed = () => txt('#team-scroll');
const next = async () => { await click('[data-act="t2-next"]'); await sleep(40); };
const choose = async (k, v) => { await click(`[data-act="t2-choose"][data-k="${k}"][data-v="${v}"]`); await sleep(800); };
const reset = async () => { await click('[data-act="t2-reset"]'); };
const goto = async (id, plan = {}) => { for (let g = 0; g < 60; g++) { const cur = await sid(); if (cur === id) return true; const key = await page.evaluate(() => { const s = teamSteps()[S.team.i]; return s.need && !S.team.choice[s.need] ? s.need : null; }); if (key) { if (!plan[key]) return false; await choose(key, plan[key]); } else { if (await page.locator('[data-act="t2-next"]').isDisabled()) return false; await next(); } } return false; };
const ledger = () => page.evaluate(() => { const L = ledgerAt(S.team.i); return { crit: Object.fromEntries(Object.entries(L.crit).map(([k, v]) => [k, v.text])), ev: L.ev, changes: L.changes, items: L.items.map((x) => x[0]), dec: L.dec.map((d) => d[0]), devSub: L.devSub, accepted: L.accepted, out: L.out, review: L.review, meet: L.meet }; });
R.version = await page.locator('meta[name="prototype-version"]').getAttribute('content');
const DEF = { D2: 'folder', BASE: 'ok', ACC: 'accept' };

// ---- daily and follow regression
await click('#pill'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
ok('daily: picker keyboard select', /GPT-6-Astra · High/.test(await txt('#pill')));
await click('#pill'); await page.keyboard.press('Escape'); ok('daily: esc closes picker and focus returns', await page.locator('#pop').count() === 0 && await page.evaluate(() => document.activeElement.id === 'pill'));
await click('[data-act="scene"][data-v="follow"]');
const fchoose = async (k, v) => { await click(`[data-act="fchoose"][data-k="${k}"][data-v="${v}"]`); await sleep(800); };
await fchoose('CHK', 'ok'); await fchoose('FIX', 'auto'); await click('[data-act="fnext"]'); await fchoose('CI', 'timeout');
let fb = await txt('#follow-scroll');
ok('follow: timeout keeps following instead of asking', /每 10 分钟查看一次/.test(fb) && !/不再自动等/.test(fb) && !/说一声/.test(fb) && /等 CI/.test(await txt('#side .row.active')), fb.slice(-200));
await shot('follow-timeout', '单聊：CI 等待超时后，助手说明还在排队，改成每 10 分钟看一次并先在本地跑检查；左栏仍显示在等 CI');
await click('[data-act="fnext"]'); fb = await txt('#follow-scroll'); ok('follow: ends on its own after the timeout', /34 分钟后 CI 运行 #482 结束：通过/.test(fb) && !/等 CI/.test(await txt('#side .row.active')));
await click('[data-act="freset"]'); await fchoose('CHK', 'ok'); await fchoose('FIX', 'auto'); await click('[data-act="fnext"]'); await fchoose('CI', 'fail'); await click('[data-act="fnext"]'); ok('follow: CI fail path still works', /#483 结束：通过/.test(await txt('#follow-scroll')));

// ---- entry and setup: what you configure is what you get
await click('[data-act="scene"][data-v="daily"]'); await click('#new-team');
ok('entry: new team from the sidebar opens setup with focus in the idea', await page.locator('.dlg').count() === 1 && await page.evaluate(() => document.activeElement.id === 'idea'));
await page.fill('#idea', '给设置页加一个搜索框，输入关键词能定位到对应的设置项');
await click('#sp-dev-main'); ok('setup: picker opens with keyboard focus inside', await page.locator('#sp').count() === 1 && await page.evaluate(() => !!document.activeElement.closest('#sp')));
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await shot('setup-picker', '建队：给开发选模型和档位，用的是和单聊同一套两列选择器，Codex 的档位叫 Reasoning');
await page.keyboard.press('Enter');
const devBtn = await txt('#sp-dev-main'); ok('setup: keyboard pick shows model and vendor term', /Codex · GPT-6-Astra · Reasoning: High/.test(devBtn) && await page.evaluate(() => document.activeElement.id === 'sp-dev-main'), devBtn);
await click('#sp-qa-main'); await click('#sp .mrow:has-text("Opus 5.5")'); await click('#sp .erow:has-text("Extra")'); ok('setup: mouse pick uses Claude terms', /Claude Code · Opus 5.5 · Effort: Extra/.test(await txt('#sp-qa-main')), await txt('#sp-qa-main'));
await click('#sp-dev-main'); ok('setup: no Ultra offered to a seat', await page.locator('#sp .erow:has-text("Ultra")').count() === 0 && await page.locator('#sp .erow').count() === 5 && /不提供 Ultra/.test(await txt('#sp .elist'))); await page.keyboard.press('Escape'); ok('setup: esc closes only the picker', await page.locator('#sp').count() === 0 && await page.locator('.dlg').count() === 1);
await click('#sp-dev-sub'); await click('[data-act="t2-sp-none"]'); ok('setup: substitute can be removed', /替补：不设/.test(await txt('#sp-dev-sub')));
await page.selectOption('#cfg-demo', '明天 10:00'); await page.fill('#cfg-turns', '30'); await page.uncheck('#au-push');
await click('[data-act="t2-start"]');
let f = await feed(); let side = await txt('#side .side-list'); let head = await txt('.head');
ok('setup result: title, idea and note follow the typed idea', /给设置页加一个搜索框/.test(head) && /输入关键词能定位到对应的设置项/.test(f) && /原型说明：你改了想法/.test(f), head);
ok('setup result: seats follow the choices', /GPT-6-Astra/.test(side) && /Opus 5.5/.test(side) && /Reasoning: High/.test(f) && /Effort: Extra/.test(f), side);
ok('setup result: deadline, budget and authorization follow the choices', /截止 明天 10:00/.test(head) && /\/30 回合/.test(head) && /已授权：运行检查、开草稿 PR/.test(f) && !/提交和推送、/.test(f), f.slice(0, 300));
await shot('setup-result', '建队结果：标题、想法、三位成员的模型和档位、截止时间、预算、授权都来自刚才的输入');
ok('no substitute: quota waits without asking', await goto('s10', DEF) && /建队时没有给开发选替补/.test(await feed()) && !(await page.evaluate(() => needOpen(teamSteps()[S.team.i]))));
await click('[data-act="t2-setup"]'); await click('#sp-dev-main'); await click('#sp .mrow:has-text("Sonnet 5.5")'); await click('#sp .erow:has-text("Medium")');
ok('setup: Tab stays inside the dialog', await page.evaluate(() => { const list = [...document.querySelectorAll('.dlg textarea, .dlg select, .dlg input, .dlg button')].filter((x) => !x.disabled); list[list.length - 1].focus(); return true; }) && (await page.keyboard.press('Tab'), await page.evaluate(() => document.activeElement.id === 'idea')));
ok('setup: same source wording is not absolute', /同一家，可能有相同的盲区/.test(await txt('#seat-hint')) && !/不能当作独立验证/.test(await txt('#seat-hint'))); await page.keyboard.press('Escape'); ok('setup: closing returns focus to the control that opened it', await page.locator('.dlg').count() === 0 && await page.evaluate(() => document.activeElement && document.activeElement.dataset.act === 't2-setup'));

// ---- default path
await page.evaluate(() => { S.team = freshTeam(); renderAll(); });
ok('default: team starts at s0 with the default idea', (await sid()) === 's0' && /导出为 Markdown/.test(await txt('.head')));
await goto('s3', DEF); await click('[data-act="t2-open"][data-v="M1"]'); f = await feed();
ok('toggling a fold does not replay the entry animation', await page.locator('#team-scroll .fadein').count() === 0);
ok('s3: the team settles a disagreement without the boss', /团队自己定/.test(f) && /各自独立写主张/.test(f) && /我改方案/.test(f) && /保留意见/.test(f) && /接下来/.test(f) && !(await page.evaluate(() => needOpen(teamSteps()[S.team.i]))));
await shot('team-meeting', '团队自己解决的分歧：展开讨论能看到两人的主张、PM 的建议、各自的回应、结论、决定人、保留意见和每个人的下一步');
await next(); ok('s4: a change of deliverable goes to the boss with positions', (await sid()) === 's4' && /会改变交付出来的东西/.test(await feed()) && await page.locator('.strip .need').count() === 1);
await choose('D2', 'folder');
// baseline: diff, edit, send back
await click('[data-act="t2-open"][data-v="diff2"]'); ok('baseline: diff against the previous version', /来自讨论 M1/.test(await txt('.diff')) && await page.locator('.diff del').count() >= 2);
await click('[data-act="t2-edit"][data-v="A2"]'); ok('baseline: inline edit takes focus', await page.evaluate(() => document.activeElement.id === 'base-edit'));
await page.fill('#base-edit', '1000 条消息的对话，按 D1 截断后，导出不超过 2 秒'); await page.keyboard.press('Enter');
ok('baseline: the edited criterion shows as yours', /不超过 2 秒/.test(await feed()) && /你改的/.test(await feed()) && (await ledger()).crit.A2.includes('2 秒'));
await shot('baseline-edit-diff', '基线卡片：可以看和上一版的差异、直接改一条标准（标成“你改的”）、退回讨论，不只是确认');
await click('[data-act="t2-open"][data-v="baseBack"]'); ok('baseline: send-back box takes focus', await page.evaluate(() => document.activeElement.id === 'base-note'));
await page.fill('#base-note', '导出时要能选只导出最近 50 条'); await click('[data-act="t2-sendback"]'); await sleep(800);
f = await feed(); ok('baseline: the note goes back to the team and becomes a criterion', (await sid()) === 's5r' && /导出时要能选只导出最近 50 条/.test(f) && /基线没有确认，团队不会开工/.test(f) && (await ledger()).crit.A7 === '导出时要能选只导出最近 50 条');
await next(); await click('[data-act="t2-open"][data-v="diff3"]'); ok('baseline v3: diff shows only the new criterion', (await sid()) === 's5b' && /你的退回意见/.test(await page.locator('.diff').last().innerText()) && !/A2/.test(await page.locator('.diff').last().innerText()));
await choose('BASE2', 'ok'); ok('baseline v3 confirmed, work starts', (await sid()) === 's6' && (await ledger()).items.includes('W1'));
// member view and return
await click('#side [data-act="t2-view"][data-v="dev"]'); let mv = await txt('#center');
ok('member view: shows what the app handed over and what the member said', /应用交给它/.test(mv) && /核心和命令行都写完了/.test(mv) && /只有开发能写/.test(mv) && await page.evaluate(() => document.activeElement.id === 'back-team'), mv.slice(0, 200));
await shot('member-view', '点左栏的开发：进入它自己的对话，能看到应用每一步交给它的事和它的回复；左上角和 Esc 都能回到团队');
await page.keyboard.press('Escape'); ok('member view: esc returns to the team and focus lands on the member row', await page.locator('.sit').count() === 1 && await page.evaluate(() => document.activeElement.dataset.v === 'dev'));
// talking in the group
await click('#t2-input'); await page.keyboard.type('@'); ok('composer: typing @ lists the members', await page.locator('.men button').count() === 3);
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); ok('composer: keyboard picks a member', (await page.inputValue('#t2-input')) === '@开发 ');
await page.keyboard.type('导出的文件名带上对话标题'); await page.keyboard.press('Enter'); f = await feed(); let L = await ledger();
ok('@member: delivered, handled, recorded and visible to the team', /这条排在它后面|已送达 开发/.test(f) && /我已经报给 PM 记账/.test(f) && /已记成标准 A9/.test(f) && /影响：标准多 1 条/.test(f) && L.crit.A9 === '导出的文件名带上对话标题' && L.items.includes('W9') && (await page.inputValue('#t2-input')) === '' && await page.evaluate(() => document.activeElement.id === 't2-input'), L);
await click('[data-act="t2-chip"][data-v^="先不做命令行"]'); await page.keyboard.press('Enter'); L = await ledger();
ok('change of direction: takes effect and removes the criterion and the work item', !L.crit.A4 && !L.items.includes('W2') && L.changes.some((c) => c[0] === 'A4') && /标准少 1 条（A4）/.test(await feed()));
await click('[data-act="t2-chip"][data-v^="@QA"]'); await page.keyboard.press('Enter'); ok('@QA: more testing, no change to the standards', (await ledger()).items.includes('W10') && /标准不变/.test(await feed()));
await page.fill('#t2-input', '整体风格保持简洁'); await click('[data-act="t2-send"]'); ok('free text: acknowledged as a note', /我的理解是补充说明/.test(await feed()) && /整体风格保持简洁/.test(await feed()));
await shot('group-talk', '在群里说话：@开发 的要求被开发接下、由 PM 记成标准；改方向直接生效并列出影响；每条都有送达和处理状态');
await click('[data-act="t2-tab"][data-v="board"]'); ok('panel: work items reflect the messages', /W9/.test(await txt('#panel .pbody')) && /W10/.test(await txt('#panel .pbody')) && !/W2/.test(await txt('#panel .pbody')));
// timeout, checks, issue, substitute
await next(); f = await feed(); ok('s7: CI wait timeout is followed by the team, not handed to the boss', (await sid()) === 's7' && /排队中/.test(f) && /我不干等/.test(f) && /每 10 分钟查看一次/.test(f) && /没有打扰你/.test(f) && await page.locator('.strip .need').count() === 0);
await shot('team-ci-timeout', '团队：CI 等了 20 分钟还在排队，开发在授权范围内改成定期查看并先跑本地检查，没有来问老板');
await next(); f = await feed(); ok('s8: failed check is fixed inside the team and A4 stays removed', /这次和上次不同的地方/.test(f) && !(await ledger()).crit.A4 && (await ledger()).out === 'v1');
await next(); f = await feed(); ok('s9: QA issue carries steps, a screenshot and the violated criterion', /导出后图片是破图/.test(f) && /复现步骤加一张截图/.test(f) && /违反的是已确认的 A3/.test(f));
await next(); f = await feed(); side = await txt('#side .side-list');
ok('s10: the substitute takes over without a boss decision', /替补已接手/.test(f) && /Sonnet 5.5（替补）/.test(side) && (await ledger()).devSub && await page.locator('.strip .need').count() === 0);
await shot('team-substitute', '额度用尽：建队时选好的替补直接接手，不需要老板点；卡片上可以改成等原来的模型恢复');
await click('[data-act="t2-choose"][data-k="Q"][data-v="wait"]'); await sleep(200); ok('s10: can switch to waiting for the original model', /按你的选择等恢复/.test(await feed()) && !(await ledger()).devSub && (await sid()) === 's10');
await click('[data-act="t2-prev"]'); await next(); ok('s10: back restores the default substitute', (await ledger()).devSub);
await next(); ok('s11: fix, app re-run and QA re-verify close the issue', /应用重跑了 QA 的复现步骤：通过/.test(await feed()) && /问题 #1 关闭/.test(await feed()) && (await ledger()).ev.A3 === 'ok');
// PM product review
await next(); f = await feed(); L = await ledger();
ok('s12: all checks pass and the PM still rejects on product quality', (await sid()) === 's12' && /全部通过/.test(f) && /打回，暂不演示/.test(f) && /分不清谁说的/.test(f) && /不是新加的要求/.test(f) && L.review === 'rejected' && L.ev.E1 === 'err' && L.items.includes('W5') && await page.locator('.strip .need').count() === 0);
await click('.card.rev [data-act="t2-tab"][data-v="out"]'); ok('s12: the boss can open what the PM looked at', await page.locator('#panel .mdp[data-ver="v1"]').count() === 1 && /已经打回/.test(await txt('#panel .pbody')));
await shot('pm-review-reject', '检查全过、QA 没发现功能错误，PM 打开真实产出后仍然打回：三处问题各写了哪里、为什么、应该怎样；右侧是 PM 看到的产出');
await next(); f = await feed(); L = await ledger(); ok('s13: fixed, re-verified, PM passes on the second review', /产品评审 第 2 次/.test(f) && /通过，可以演示/.test(f) && L.review === 'passed' && L.out === 'v2' && L.ev.E1 === 'ok' && L.ev.A9 === 'ok' && await page.locator('#panel .mdp[data-ver="v2"]').count() === 1);
// demo
await next(); f = await feed(); ok('s14: the demo leads with the real result', (await sid()) === 's14' && await page.locator('#team-scroll .card.need .mdp[data-ver="v2"]').count() === 1 && /命令行导出按你的要求去掉了/.test(f) && !/A4/.test(await txt('#team-scroll .card.need .src')));
await click('#team-scroll [data-act="t2-before"][data-v="1"]'); ok('s14: before and after can be compared', await page.locator('#team-scroll .card.need .mdp[data-ver="v1"]').count() === 1); await click('#team-scroll [data-act="t2-before"][data-v="0"]');
await click('[data-act="t2-open"][data-v="dm-crit1"]'); ok('s14: criteria are one click away and counted by the app', /通过数由应用按证据统计/.test(await feed()));
await shot('demo', '演示：最上面是导出文件的真实样子，可切换“PM 打回之前”；标准、决定、变更收在下面按需展开');
await click('[data-act="t2-open"][data-v="chg"]'); ok('demo: change request box takes focus', await page.evaluate(() => document.activeElement.id === 'chg-note'));
await page.fill('#chg-note', '文件开头再加一行这条对话用了哪个模型'); await click('[data-act="t2-sendchange"]'); await sleep(800); f = await feed();
ok('demo: the typed request drives the next round', (await sid()) === 's15' && /文件开头再加一行这条对话用了哪个模型/.test(f) && /我的理解是你要改/.test(f) && (await ledger()).crit.A8 === '文件开头再加一行这条对话用了哪个模型');
await next(); f = await feed(); ok('demo 2: shows the request as done', (await sid()) === 's16' && /这一版只多了一件事，就是你要的/.test(f) && /文件开头再加一行这条对话用了哪个模型/.test(f));
await shot('demo-round2', '要求修改：输入的原话成了一条标准和一个工作项，第二次演示只讲这一件事');
await choose('ACC2', 'accept'); f = await feed(); L = await ledger();
ok('end: summary counts decisions, talks, meetings and the substitute', (await sid()) === 'end' && L.accepted && /0 次催促/.test(f) && /4 次主动说话/.test(f) && /产品评审打回 1 次/.test(f) && /1 次，自动接手/.test(f) && /A8 新增/.test(f) && /A4 去掉/.test(f), f.slice(-400));
// back removes later messages and choices
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await goto('s6', DEF); await click('[data-act="t2-chip"][data-v^="先不做命令行"]'); await page.keyboard.press('Enter'); await next(); await click('[data-act="t2-prev"]'); await click('[data-act="t2-prev"]');
ok('back: undoes the message and its effect', (await page.evaluate(() => S.team.msgs.length)) === 0 && (await sid()) === 's5');

// ---- plain default path: how many boss decisions
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); ok('default path reaches the end', await goto('end', DEF)); f = await feed();
ok('default path: three boss decisions, none for quota, timeout or review', /3 次决定（图片形态、确认基线、验收）/.test(f) && /0 次主动说话/.test(f), f.slice(-300));
R.defaultSteps = await page.evaluate(() => teamSteps().map((s) => s.id).join(','));
ok('default path: collapsed earlier phases keep the page short', await page.locator('.phfold').count() >= 4 && await page.evaluate(() => document.querySelector('#team-scroll').scrollHeight) < 2200, await page.evaluate(() => document.querySelector('#team-scroll').scrollHeight));
await click('[data-act="t2-open"][data-v="ph1"]'); ok('collapsed phase opens on demand', /两份独立意见/.test(await feed()));

// ---- simulated events
const sim = async (v) => { const b = page.locator(`[data-act="t2-sim"][data-v="${v}"]`); if (await b.isDisabled()) return false; await b.click(); await sleep(700); return true; };
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await goto('s8', DEF);
ok('sim silent: handled by the app', await sim('silent') && /只补报告，不重做/.test(await feed()) && /没有找你/.test(await feed()));
ok('sim weaken: relaxing a criterion still needs the boss', await sim('weaken') && (await sid()) === 's8w' && /PM 申请放宽标准/.test(await feed()) && await page.locator('.strip .need').count() === 1);
await choose('WEAK', 'no'); ok('weaken refused: criterion unchanged', /3 秒/.test((await ledger()).crit.A2) && !(await ledger()).changes.length);
await goto('s9', DEF); ok('sim restart: banner and recovery', await sim('restart') && /14:32 重启过/.test(await feed()));
ok('sim deadline: forced honest demo', await sim('deadline') && (await sid()) === 'sdl' && /到点演示/.test(await feed()) && /还没有证据的标准/.test(await feed()) && /A3/.test(await txt('#team-scroll .card.need')));
await shot('deadline-demo', '到截止时间：PM 必须按现状演示，没有证据的标准如实列出；老板选加时间还是按现状验收');
await choose('DL', 'extend'); ok('deadline extend: the team continues', (await sid()) === 's10');
await click('[data-act="t2-prev"]'); await choose('DL', 'accept'); ok('deadline accept: ends as is', (await sid()) === 'end' && (await ledger()).accepted);
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await goto('s11', DEF);
ok('sim stuck: the team changes approach without the boss', await sim('stuck') && (await sid()) === 's11s' && /统一重写图片引用/.test(await feed()) && /不用找老板/.test((await click('[data-act="t2-open"][data-v="M3"]'), await feed())) && /换做法而不是再补一次/.test(await feed()) && await page.locator('.strip .need').count() === 0 && (await ledger()).ev.A3 === 'ok');
await shot('stuck-strategy', '同一处反复失败：应用叫停重复尝试，团队开短会换做法并换模型来写，没有把问题退给老板');
// other D2 choices change the issue
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await goto('s9', { ...DEF, D2: 'single' }); ok('D2 single changes the later issue', /61 MB/.test(await feed()));
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await goto('s14', { ...DEF, D2: 'none' }); ok('D2 none changes the preview', await page.locator('#team-scroll .mdp-img').count() === 0 && /残留图片占位行/.test((await click('[data-act="t2-open"][data-v="ph3"]'), await feed())));
// panel pages and wording
await click('[data-act="t2-tab"][data-v="seats"]'); const seats = await txt('#panel .pbody');
ok('panel members: four separate reliability dimensions, no absolute claim, no jargon', /独立的对话/.test(seats) && /独立的工作区/.test(seats) && /检查由应用执行/.test(seats) && /模型来源/.test(seats) && /来源不同不保证结论一定对/.test(seats) && !/不变量/.test(seats));
await click('[data-act="t2-tab"][data-v="ev"]'); ok('panel evidence: rendering is proved by a preview, not by lint alone', /渲染预览和截图/.test(await txt('#panel .pbody')));
await click('[data-act="t2-tab"][data-v="board"]'); ok('panel progress: plain wording', !/不变量/.test(await txt('#panel .pbody')) && /在等的事/.test(await txt('#panel .pbody')));
// keyboard stepping and autoplay
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await page.keyboard.press('ArrowRight'); ok('keyboard: arrow advances', (await sid()) === 's1');
await click('[data-act="t2-auto"]'); await sleep(2600 * 4 + 600); ok('autoplay stops at the first boss decision', (await sid()) === 's4');
R.checks = checks; R.errs = errs; R.fails = fails; R.passed = fails.length === 0 && errs.length === 0;
console.log(JSON.stringify(R, null, 1));
await page.close(); await browser.close();
