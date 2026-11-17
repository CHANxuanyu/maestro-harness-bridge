// Walkthrough and checks for prototype P7. Usage: PROTO_URL=file://… SHOTS=<dir> node run7.mjs  (needs a Chrome with --remote-debugging-port=9351)
// Checks are grouped by the rule they verify. They assert the revised rules; none of them asserts the old "third review demos anyway" behaviour.
import { createRequire } from 'module';
const require = createRequire('<任意装有 playwright-core 的 node_modules>/');
const { chromium } = require('playwright-core');
const FILE = process.env.PROTO_URL; const SHOTS = process.env.SHOTS;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9351');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage(); await page.setViewportSize({ width: 1440, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(FILE); await page.waitForSelector('#pbar .brand');
const R = { walk: [], groups: {} }; const fails = []; let checks = 0; let group = '';
const G = (name) => { group = name; R.groups[name] = R.groups[name] || 0; };
const ok = (name, cond, extra) => { checks++; R.groups[group]++; if (!cond) fails.push(`[${group}] ${name}` + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 240) : '')); };
const click = (sel) => page.locator(sel).first().click();
const txt = (sel) => page.locator(sel).first().innerText();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, note) => { await page.screenshot({ path: `${SHOTS}/p7-${name}.png` }); R.walk.push([name, note]); };
const sid = () => page.evaluate(() => teamSteps()[S.team.i].id);
const feed = () => txt('#team-scroll');
const strip = () => txt('.sit');
const needCount = () => page.locator('.strip .need').count();
const next = async () => { await click('[data-act="t2-next"]'); await sleep(40); };
const choose = async (k, v) => { await click(`[data-act="t2-choose"][data-k="${k}"][data-v="${v}"]`); await sleep(800); };
const sim = async (v) => { const b = page.locator(`[data-act="t2-sim"][data-v="${v}"]`); if (await b.isDisabled()) return false; await b.click(); await sleep(700); return true; };
const fresh = async (cfg) => { await page.evaluate((c) => { S.scene = 'team'; S.team = freshTeam(); if (c) Object.assign(S.team.cfg, c); renderAll(); }, cfg || null); };
const goto = async (id, plan = {}) => { for (let g = 0; g < 70; g++) { const cur = await sid(); if (cur === id) return true; const key = await page.evaluate(() => { const s = teamSteps()[S.team.i]; return s.need && !S.team.choice[s.need] ? s.need : null; }); if (key) { if (!plan[key]) return false; await choose(key, plan[key]); } else { if (await page.locator('[data-act="t2-next"]').isDisabled()) return false; await next(); } } return false; };
const ledger = () => page.evaluate(() => { const L = ledgerAt(S.team.i); return { crit: Object.fromEntries(Object.entries(L.crit).map(([k, v]) => [k, v.text])), ev: L.ev, changes: L.changes, items: L.items.map((x) => x[0]), devSub: L.devSub, accepted: L.accepted, endKind: L.endKind, residual: L.residual, out: L.out, review: L.review, rejects: L.rejects, retro: L.retro, meet: L.meet, pmAlt: L.pmAlt ? L.pmAlt.model : null, pmFault: L.pmFault, suggest: L.suggest }; });
R.version = await page.locator('meta[name="prototype-version"]').getAttribute('content');
const DEF = { D2: 'folder', BASE: 'ok', ACC: 'accept' };

// ======================================================================
G('日常对话回归');
await click('#pill'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
ok('选择器键盘选择', /GPT-6-Astra · High/.test(await txt('#pill')));
await click('#pill'); await page.keyboard.press('Escape'); ok('Esc 关闭并归还焦点', await page.locator('#pop').count() === 0 && await page.evaluate(() => document.activeElement.id === 'pill'));

// ======================================================================
G('单聊：一次授权，同一范围内不再问');
await click('[data-act="scene"][data-v="follow"]');
const fchoose = async (k, v) => { await click(`[data-act="fchoose"][data-k="${k}"][data-v="${v}"]`); await sleep(800); };
const fsim = async (v) => { const b = page.locator(`[data-act="fsim"][data-v="${v}"]`); if (await b.isDisabled()) return false; await b.click(); await sleep(700); return true; };
const fid = () => page.evaluate(() => followSteps()[S.follow.i].id);
const fbody = () => txt('#follow-scroll');
const freset = async () => { await click('[data-act="freset"]'); };
let fb = await fbody();
ok('授权卡片写的是项目级授权，不是逐次确认', /允许应用在这个项目里运行检查命令/.test(fb) && /以后助手改了命令也不再问你/.test(fb) && !/之后改动命令也要你确认/.test(fb));
await click('[data-act="ftab"][data-v="checks"]'); ok('检查页说明授权边界', /项目里第一次有检查命令时问一次/.test(await txt('#panel .pbody')) && !/之后改动命令也要你确认/.test(await txt('#panel .pbody')));
await fchoose('CHK', 'ok'); await fchoose('FIX', 'auto'); fb = await fbody();
ok('改了检查命令，仍在授权内，没有再问', /检查命令改了/.test(fb) && /在你已经给的授权之内，没有再问你/.test(fb) && await page.locator('#follow-scroll .card.need').count() === 0);
await click('[data-act="ftab"][data-v="checks"]'); ok('检查页显示改后的命令，状态在授权内', /src\/draft\.test\.ts/.test(await txt('#panel .pbody')) && /在项目授权内，由应用运行/.test(await txt('#panel .pbody')));
ok('超出授权的检查：具体请求', await fsim('outside') && (await fid()) === 'f2o' && /超出了授权范围/.test(await fbody()) && /项目之外/.test(await fbody()));
ok('超出授权的卡片没有“继续”按钮，只有两项具体选择', (await page.locator('#follow-scroll .card.need .btn').allInnerTexts()).join('|') === '只允许这一次|不加这条检查');
await shot('follow-outside-auth', '单聊：项目内改检查命令没有再问；这条要下载浏览器到项目之外，单独提出具体请求');
await fchoose('OUT', 'once'); ok('只允许一次，没有扩大授权', /授权只用这一次，没有扩大/.test(await fbody()) && (await fid()) === 'f3');

// ======================================================================
G('单聊：三种限度分开');
fb = await fbody();
ok('登记时显示单次等待、总时限、到期行为', /单次等待/.test(fb) && /跟进总时限/.test(fb) && /最迟到 16:20/.test(fb) && /到期时/.test(fb) && /最后看一次，写下现状，停止跟进并告诉你/.test(fb));
await page.selectOption('#f-limit', '4'); ok('总时限可调整，最迟时间跟着变', /最迟到 18:20/.test(await fbody()) && (await page.evaluate(() => S.follow.limit)) === 4);
await page.selectOption('#f-limit', '2');
await fchoose('CI', 'timeout'); fb = await fbody();
ok('单次等待超时后接着跟，不问', /每 10 分钟查看一次，最迟到 16:20/.test(fb) && /等 CI/.test(await txt('#side .row.active')) && await page.locator('#follow-scroll .card.need').count() === 0);
await click('[data-act="fnext"]'); fb = await fbody();
ok('合法等待：三次查询结果不变，不算失败', (await fid()) === 'f4b' && /查询 3 次结果都没变/.test(fb) && /这是等待，不是失败，不累计“无进展”/.test(fb) && /等 CI/.test(await txt('#side .row.active')) && !/needdot/.test(await page.locator('#side .row.active').innerHTML()));
await shot('follow-legit-wait', '单聊：CI 一直在排队，三次查询结果不变，判为正常等待，不累计无进展，也不打扰你');
await click('[data-act="fnext"]'); ok('等待自己收尾', /15:26 CI 运行 #482 结束：通过/.test(await fbody()) && !/等 CI/.test(await txt('#side .row.active')));
// expiry
await click('[data-act="fprev"]'); await click('[data-act="fprev"]'); await click('[data-act="fprev"]');
ok('后退撤销 CI 选择', (await fid()) === 'f3' && await page.locator('[data-act="fchoose"][data-k="CI"]:not([disabled])').count() === 5);
await fchoose('CI', 'expire'); fb = await fbody();
ok('总时限到期：停下并写明现状和推荐', /跟进总时限到了（2 小时）/.test(fb) && /停止自动跟进/.test(fb) && /推荐延长 1 小时/.test(fb) && /runner 不够，不是代码问题/.test(fb));
ok('到期卡片是两项具体选择', (await page.locator('#follow-scroll .card.need .btn').allInnerTexts()).join('|') === '延长 1 小时|不再跟进');
await click('[data-act="ftab"][data-v="follows"]'); ok('跟进页显示已到期', /跟进已到期/.test(await txt('#panel .pbody')));
await shot('follow-expired', '单聊：跟进总时限是硬边界，到期后停下，给出现状、原因和推荐');
await fchoose('EXP', 'more'); ok('延长后自己收尾', /跟进延长 1 小时/.test(await fbody()));
await click('[data-act="fprev"]'); await fchoose('EXP', 'stop'); ok('不再跟进：左栏不再显示等 CI', /已停止跟进/.test(await fbody()) && !/等 CI/.test(await txt('#side .row.active')));

// ======================================================================
G('单聊：三次无进展先诊断，换打法');
await freset(); await fchoose('CHK', 'ok');
ok('无进展模拟在 f1 可用', await fsim('stuck'));
await fchoose('FIX', 'auto'); fb = await fbody();
ok('三次修复记录，签名相同，判为无进展', (await fid()) === 'f2' && /无进展：同一条报错/.test(fb) && /三次的失败签名完全相同/.test(fb));
ok('三次无进展没有显示“需要你”，也没有停下', await page.locator('#follow-scroll .card.need').count() === 0 && !/needdot/.test(await page.locator('#side .row.active').innerHTML()) && !(await page.locator('[data-act="fnext"]').isDisabled()));
await shot('follow-no-progress', '单聊：三次修复同一条报错，应用判为无进展，转入诊断，不显示“需要你”');
await click('[data-act="fnext"]'); fb = await fbody();
ok('诊断写出原因、新打法和预期变化，并按证据判为有进展', (await fid()) === 'f2d' && /诊断/.test(fb) && /换打法/.test(fb) && /下一次应该看到/.test(fb) && /和诊断预期一致，算有进展/.test(fb) && /2\/2 通过/.test(fb));
ok('诊断后没有找你', await page.locator('#follow-scroll .card.need').count() === 0);
ok('授权内办法用完：模拟可用并插入升级', await fsim('exhaust'));
await page.evaluate(() => { S.follow.i = followSteps().findIndex((s) => s.id === 'f2x'); renderAll(); });
fb = await fbody();
ok('升级卡片列出已经试过的办法', /已经试过/.test(fb) && /定位/.test(fb) && /换做法/.test(fb) && /拆小/.test(fb) && /剩下的路都超出了这条对话的授权/.test(fb) && /推荐第一项/.test(fb));
const escBtns = (await page.locator('#follow-scroll .card.need .btn').allInnerTexts()).join('|');
ok('升级卡片是具体选项，没有“继续”', /授权 Opus 5.5 接手这一个问题/.test(escBtns) && /我自己看/.test(escBtns) && !/继续/.test(escBtns), escBtns);
await shot('follow-escalation', '单聊：授权内的打法都试过仍不通过，才升级；卡片写明试过什么、为什么超出授权、推荐哪一项');
await fchoose('ESC', 'opus'); ok('授权新模型只用于这一个问题', /这条对话交回给 GPT-6.1-Sol/.test(await fbody()) && /2\/2 通过/.test(await fbody()));
await click('[data-act="fprev"]'); await fchoose('ESC', 'manual'); ok('自己接手：交付条停在 1/2', /助手停在这里/.test(await fbody()) && /1\/2 通过/.test(await fbody()));
await freset();

// ======================================================================
G('建队：配置反映到团队');
await click('[data-act="scene"][data-v="daily"]'); await click('#new-team');
ok('从左栏进入建队，焦点在想法', await page.locator('.dlg').count() === 1 && await page.evaluate(() => document.activeElement.id === 'idea'));
await page.fill('#idea', '给设置页加一个搜索框，输入关键词能定位到对应的设置项');
await click('#sp-dev-main'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
ok('键盘选模型和档位，用 Codex 的说法', /Codex · GPT-6-Astra · Reasoning: High/.test(await txt('#sp-dev-main')));
await click('#sp-qa-main'); await click('#sp .mrow:has-text("Opus 5.5")'); await click('#sp .erow:has-text("Extra")'); ok('鼠标选模型，用 Claude 的说法', /Claude Code · Opus 5.5 · Effort: Extra/.test(await txt('#sp-qa-main')));
await click('#sp-dev-main'); ok('团队成员不提供 Ultra', await page.locator('#sp .erow:has-text("Ultra")').count() === 0 && /不提供 Ultra/.test(await txt('#sp .elist'))); await page.keyboard.press('Escape');
await click('#sp-pm-sub'); ok('PM 的“不设替补”说明故障时怎么办', /故障时先恢复会话/.test(await txt('#sp'))); await page.keyboard.press('Escape');
ok('授权里有“临时接任”一项，默认勾选', await page.isChecked('#au-temp'));
ok('截止的说明是未完成报告，不是“到点演示”', /到了还没完成，团队停下来写未完成报告/.test(await txt('.dlg')) && !/到点必须演示/.test(await txt('.dlg')));
await page.selectOption('#cfg-demo', '明天 10:00'); await page.fill('#cfg-turns', '30'); await page.uncheck('#au-push');
await click('[data-act="t2-start"]');
let f = await feed(); let head = await txt('.head');
ok('标题、截止、预算、授权来自输入', /给设置页加一个搜索框/.test(head) && /截止 明天 10:00/.test(head) && /\/30 回合/.test(head) && /已授权：运行检查、开草稿 PR、成员出故障时用团队已选用的模型临时接任/.test(f), f.slice(0, 260));
ok('团队卡片写明每位成员有没有替补', /没有替补/.test(f) && /替补：Sonnet 5.5/.test(f));

// ======================================================================
G('团队：授权内继续，超出授权才问');
ok('没授权推送：开发第一次要推送时只问一次', await goto('s6a', DEF) && /推送到任务分支 team\/export-md/.test(await feed()) && /不碰 main/.test(await feed()) && (await needCount()) === 1);
await shot('team-push-auth', '团队：建队时没授权推送，开发第一次要推送时停下来问一次，说清推到哪、不推怎么办');
await choose('PUSH', 'yes'); ok('授权后开发直接推送', /按你刚才的授权/.test(await feed()));
await next(); await next(); ok('第二次推送不再问', (await sid()) === 's8' && /第二次推送到 team\/export-md：同一授权范围，没有问你/.test(await feed()) && (await needCount()) === 0);
await fresh({ auth: { checks: true, push: false, pr: true, temp: true } }); await goto('s6a', DEF); await choose('PUSH', 'no');
ok('不推送也能往下走：本地检查', /没有推送/.test(await feed()) && (await next(), (await sid()) === 's7') && /没有远端 CI 可等/.test(await feed()));
await fresh({ auth: { checks: true, push: true, pr: false, temp: true } }); await goto('end', DEF);
ok('没授权开 PR：结束时问一次', /需要你授权一次/.test(await feed()) && /开草稿 PR/.test(await feed()) && (await needCount()) === 1);
await choose('PR', 'yes'); ok('授权后开了草稿 PR，没有合并', /已按你刚才的授权开了草稿 PR #512，没有合并/.test(await feed()));

// ======================================================================
G('团队：默认路径');
await fresh(); ok('默认想法', (await sid()) === 's0' && /导出为 Markdown/.test(await txt('.head')));
await goto('s3', DEF); await click('[data-act="t2-open"][data-v="M1"]'); f = await feed();
ok('范围内分歧团队自己定', /团队自己定/.test(f) && /各自独立写主张/.test(f) && /我改方案/.test(f) && (await needCount()) === 0);
await next(); ok('改变交付形态的分歧交老板', (await sid()) === 's4' && (await needCount()) === 1);
await choose('D2', 'folder'); await click('[data-act="t2-open"][data-v="diff2"]'); ok('基线可看差异', /来自讨论 M1/.test(await txt('.diff')));
await click('[data-act="t2-edit"][data-v="A2"]'); await page.fill('#base-edit', '1000 条消息的对话，按 D1 截断后，导出不超过 2 秒'); await page.keyboard.press('Enter');
ok('基线可改', /你改的/.test(await feed()) && (await ledger()).crit.A2.includes('2 秒'));
await click('[data-act="t2-open"][data-v="baseBack"]'); await page.fill('#base-note', '导出时要能选只导出最近 50 条'); await click('[data-act="t2-sendback"]'); await sleep(800);
ok('基线可退回，意见成为新标准', (await sid()) === 's5r' && (await ledger()).crit.A7 === '导出时要能选只导出最近 50 条');
await next(); await choose('BASE2', 'ok'); ok('第三版确认后开工', (await sid()) === 's6');
await click('#side [data-act="t2-view"][data-v="dev"]'); ok('成员对话可进入', /应用交给它/.test(await txt('#center')));
await page.keyboard.press('Escape'); ok('Esc 回到团队，焦点回到成员行', await page.locator('.sit').count() === 1 && await page.evaluate(() => document.activeElement.dataset.v === 'dev'));
await click('#t2-input'); await page.keyboard.type('@'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.type('导出的文件名带上对话标题'); await page.keyboard.press('Enter');
ok('@开发：送达、处理、记账', /已记成标准 A9/.test(await feed()) && (await ledger()).crit.A9 === '导出的文件名带上对话标题');
await next(); f = await feed();
ok('团队：CI 超时后接着跟', (await sid()) === 's7' && /我不干等/.test(f) && (await needCount()) === 0);
ok('团队：合法等待，三次查看不变，不算失败', /三次查看结果都没变/.test(f) && /这是等待，不是失败，不累计“无进展”/.test(f));
await shot('team-legit-wait', '团队：CI 超时后开发接着跟；三次查看结果不变，仍判为正常等待');
await goto('s12', DEF); f = await feed();
ok('PM 打回：每条写位置、对应标准、影响、期待', /位置：全文每条消息/.test(f) && /对应：E1/.test(f) && /影响：/.test(f) && /应该是：/.test(f));
ok('不对应已确认标准的想法列为后续建议，不打回', /后续建议/.test(f) && /不对应任何已确认标准，不打回，也不加进本轮/.test(f) && (await ledger()).suggest.includes('导出时可以选择不含工具输出'));
await shot('pm-review-reject', 'PM 第一次评审：检查全过仍打回；每条写明位置、对应的标准、影响和期待；没有对应标准的想法列为后续建议');
await next(); ok('第二次评审通过，所有标准都有证据才放行', (await sid()) === 's13' && /所有已确认的标准都有了证据/.test(await feed()) && Object.values((await ledger()).ev).every((v) => v === 'ok'));
await next(); ok('演示只在全部达标后出现', (await sid()) === 's14' && /所有已确认的标准都有证据，PM 评审已通过/.test(await feed()));
await click('[data-act="t2-open"][data-v="chg"]'); await page.fill('#chg-note', '文件开头再加一行这条对话用了哪个模型'); await click('[data-act="t2-sendchange"]'); await sleep(800);
ok('要求修改驱动下一轮', (await sid()) === 's15' && (await ledger()).crit.A8 === '文件开头再加一行这条对话用了哪个模型');
await next(); await choose('ACC2', 'accept'); f = await feed(); let L = await ledger();
ok('全部达标的终态', (await sid()) === 'end' && L.endKind === 'all' && /已验收：全部达标/.test(await strip()));
ok('统计来自实际路径：打回 1 次，没有复盘', /产品评审打回 1 次，最后通过/.test(f) && !/复盘/.test(f.split('这次协作')[1] || ''));
await fresh(); await goto('end', DEF); f = await feed();
ok('默认路径：老板 3 次决定，没有催促', /3 次决定（图片形态、确认基线、验收）/.test(f) && /0 次催促/.test(f), f.slice(-400));
ok('默认路径：额度、超时、检查失败、打回都没有找老板', (await page.evaluate(() => teamSteps().filter((s) => s.need).map((s) => s.id).join(','))) === 's4,s5,s14');

// ======================================================================
G('团队：三次无进展先诊断，换打法');
await fresh(); await goto('s11', DEF);
ok('三次无进展模拟可用', await sim('stuck')); f = await feed();
ok('三次修复记录，判为无进展', (await sid()) === 's11s' && /无进展：同一个复现结果/.test(f) && /三次的复现结果完全相同/.test(f) && (await needCount()) === 0);
await click('[data-act="t2-prev"]'); ok('后退会撤销模拟', (await sid()) === 's11' && !(await page.evaluate(() => !!S.team.sim.stuck)));
await sim('stuck'); f = await feed();
ok('团队复盘：原因、新打法、下一轮的进展证据', (await sid()) === 's11s' && (await click('[data-act="t2-open"][data-v="M3"]'), /下一轮的进展证据/.test(await feed())) && /和预期的进展证据一致/.test(await feed()) && (await needCount()) === 0);
await shot('team-no-progress', '团队：同一处三次无进展，团队复盘换打法并写明下一轮的进展证据，没有找老板');

// ======================================================================
G('PM 两次打回：内部复盘，不放行，也不交老板');
await fresh(); await goto('s12', DEF);
ok('再次打回模拟可用', await sim('reject2'));
f = await feed(); L = await ledger();
ok('第二次评审仍不达标，写明位置和对应标准', (await sid()) === 's13n' && /打回，暂不演示/.test(f) && /VS Code 预览，第 2 条消息/.test(f) && L.rejects === 2 && L.review === 'rejected' && (await needCount()) === 0);
await click('[data-act="t2-tab"][data-v="out"]'); ok('右侧产出是 VS Code 里展开的样子', await page.locator('#panel .mdp[data-ver="v2x"]').count() === 1);
await next(); await click('[data-act="t2-open"][data-v="M5"]'); f = await feed(); L = await ledger();
ok('连续两次打回触发复盘：查原因、换打法、写进展证据', (await sid()) === 's13r' && /为什么没收敛/.test(f) && /根因有两个/.test(f) && /下一轮的进展证据/.test(f) && L.retro === 1 && (await needCount()) === 0);
ok('细化 E1 记入标准变更，由 PM 在原意内定', L.changes.some((x) => x[0] === 'E1' && /细化/.test(x[1])));
await shot('pm-retro', '连续两次打回：团队内部复盘，查清没有收敛的原因，换打法，并写明下一轮怎样算有进展');
await next(); f = await feed(); L = await ledger();
ok('第三次评审仍不通过但有进展，继续修，不进入演示', (await sid()) === 's13c' && /有进展/.test(f) && /按规则继续修，不交给你/.test(f) && L.rejects === 3 && L.review === 'rejected' && (await needCount()) === 0 && !/演示与验收|演示（/.test(f.slice(-600)));
ok('第三次评审之后的下一步不是演示', (await page.evaluate(() => teamSteps()[S.team.i + 1].id)) === 's13d');
await shot('pm-review3-progress', '第三次评审仍不通过：复盘定下的三条子项两条已满足，有进展，团队继续修，不放行也不问你');
await next(); L = await ledger();
ok('第四次评审通过才演示', (await sid()) === 's13d' && L.review === 'passed' && Object.values(L.ev).every((v) => v === 'ok') && (await page.evaluate(() => teamSteps()[S.team.i + 1].id)) === 's14');
await next(); await choose('ACC', 'accept'); f = await feed();
ok('统计来自实际路径：打回 3 次，复盘 1 次', /产品评审打回 3 次，复盘 1 次，最后通过/.test(f));

// ======================================================================
G('截止或预算用完：未完成报告，不冒充完成');
await fresh(); await goto('s12', DEF); await sim('reject2'); await next(); await next();
ok('复盘后仍未达标时触发截止', (await sid()) === 's13c' && await sim('deadline'));
f = await feed(); L = await ledger();
ok('出现的是未完成报告，不是演示', (await sid()) === 'sdl' && /未完成报告/.test(f) && /这是进度报告，不是完成演示/.test(f) && !/所有已确认的标准都有证据，PM 评审已通过/.test(f.slice(-1200)));
ok('报告列出没有证据的标准和原因', /E1/.test(await txt('#team-scroll .card.need .gaps')) && /PM 评审未通过（打回 3 次，细化后的三条子项已满足 2\/3）/.test(f));
ok('报告列出试过什么和推荐', /团队已经试过/.test(f) && /复盘/.test(f) && /推荐/.test(f));
ok('顶部如实显示未完成', /到截止时间了，还没完成/.test(await strip()) && /还有 1 条标准没有证据：E1/.test(await strip()));
const repBtns = (await page.locator('#team-scroll .card.need .btn').allInnerTexts()).join('|');
ok('三项具体选择，没有“继续”或“按现状验收”', repBtns === '追加 2 小时|接受这 1 项遗留并验收|停止，保留分支和台账', repBtns);
await shot('deadline-report', '截止到了：团队写未完成报告，列出没有证据的标准、原因、试过什么和推荐；不是完成演示');
await choose('DL', 'more'); ok('追加后从中断处继续，规则不变，头部显示追加', (await sid()) === 'sdl2' && /追加 2 小时/.test(await txt('.head')) && (await next(), (await sid()) === 's13d'));
await click('[data-act="t2-prev"]'); await click('[data-act="t2-prev"]'); await choose('DL', 'stop'); L = await ledger();
ok('停止：终态如实', (await sid()) === 'endStop' && L.endKind === 'stop' && L.residual.join(',') === 'E1' && /已停止：未完成/.test(await strip()) && !/已验收/.test(await strip()));
// budget variant, triggered early; then accept leftovers
await fresh({ demoAt: '不设' }); await goto('s9', DEF); await sim('deadline'); f = await feed();
ok('没设截止时，触发的是回合预算，头部用量显示已用完', /回合预算用完了，还没完成/.test(await strip()) && /追加 10 个回合/.test(await txt('#team-scroll .card.need')) && /已用 40\/40 回合/.test(await txt('.head')));

// ======================================================================
G('接受遗留项：终态、证据、统计、后续责任如实');
L = await ledger(); const gapIds = Object.keys(L.crit).filter((k) => L.ev[k] !== 'ok');
await choose('DL', 'gap'); L = await ledger(); f = await feed(); const sp = await strip();
ok('终态是“接受遗留项后验收”，不是全部达标', (await sid()) === 'endGap' && L.endKind === 'gap' && new RegExp(`已验收，接受了 ${gapIds.length} 项遗留`).test(sp) && !/全部达标/.test(sp) && !/没有待解决的问题/.test(sp), sp);
ok('遗留项与触发时没有证据的标准一致', L.residual.join(',') === gapIds.join(','), { residual: L.residual, gapIds });
ok('遗留项仍标为未达标', L.residual.every((id) => L.ev[id] !== 'ok'));
ok('遗留卡片写明证据缺口和后续负责人', /你接受的遗留项/.test(f) && /证据缺口/.test(f) && /后续清单 L1/.test(f) && /验收不会把这些改成通过/.test(f));
ok('统计来自实际路径：没到评审就不写打回', /还没到产品评审/.test(f) && !/打回 1 次/.test(f) && new RegExp(`接受 ${gapIds.length} 项遗留后验收`).test(f), f.slice(-500));
await click('[data-act="t2-tab"][data-v="board"]'); ok('进展页列出遗留项和负责人', /遗留项（你已接受）/.test(await txt('#panel .pbody')) && /负责人待你安排/.test(await txt('#panel .pbody')));
await click('[data-act="t2-tab"][data-v="ev"]'); ok('证据页保留未通过的状态', /未通过|待证明|待核对/.test(await txt('#panel .pbody')) && /验收之后仍然保持原样/.test(await txt('#panel .pbody')));
ok('左栏写“已验收·有遗留”', /已验收·有遗留/.test(await txt('#side .side-list')));
await shot('accepted-with-gaps', '接受遗留项后：顶部写明接受了几项遗留，遗留项仍标为未达标并记入后续清单，统计按实际路径');

// ======================================================================
G('PM 故障：分清状态，有限的自动恢复');
await fresh(); await goto('s9', DEF);
ok('PM 会话损坏模拟可用', await sim('pmSession')); f = await feed();
ok('会话损坏：核对、重试、从台账恢复，没有替补也能恢复', (await sid()) === 'spf1' && /核对已有结果/.test(f) && /不会重做/.test(f) && /从台账恢复会话/.test(f) && /PM 已恢复/.test(f) && (await needCount()) === 0);
ok('现状由应用生成，不依赖 PM', /由应用根据台账生成，不依赖 PM/.test(f) && /条标准里/.test(f) && /预算/.test(await txt('#team-scroll .card.appgen')));
await shot('pm-fault-session', 'PM 会话损坏、没有替补：应用核对已完成的动作，重试失败后从台账恢复会话；现状由应用生成');
await fresh({ seats: { ...(await page.evaluate(() => defaultCfg().seats)), pm: { tool: 'claude', model: 'claude-opus-5-5', effort: 'high', sub: { tool: 'codex', model: 'gpt-6-astra', effort: 'medium' } } } });
await goto('s9', DEF); await sim('pmModel'); f = await feed(); L = await ledger();
ok('模型不可用、有替补：替补接任，不问老板', (await sid()) === 'spf2' && /已授权替补/.test(f) && /GPT-6-Astra 接任 PM/.test(f) && L.pmAlt === 'gpt-6-astra' && (await needCount()) === 0);
await next(); ok('之后 PM 的发言显示替补的模型', /PM GPT-6-Astra|PMGPT-6-Astra/.test((await txt('#side .side-list')).replace(/\s+/g, '')) || /替补/.test(await txt('#side .side-list')));
await shot('pm-fault-sub', 'PM 的模型用量到上限、设了替补：应用按顺序恢复，替补接任，不需要你');
await fresh(); await goto('s9', DEF); await sim('pmModel'); f = await feed(); L = await ledger();
ok('模型不可用、没替补、授权了临时接任：用团队已选用的模型接上', /没有给 PM 设替补/.test(f) && /用团队已选用的模型临时接任/.test(f) && L.pmAlt === 'claude-sonnet-5-5' && (await needCount()) === 0);
await fresh({ auth: { checks: true, push: true, pr: true, temp: false } }); await goto('s9', DEF); await sim('pmModel'); f = await feed();
ok('授权内办法都用完才问，问的是具体一件事', (await sid()) === 'spf2' && /授权范围内的恢复办法都试过了/.test(f) && /已经试过：/.test(f) && (await needCount()) === 1);
const pmBtns = (await page.locator('#team-scroll .card.need .btn').allInnerTexts()).join('|');
ok('具体选项：允许临时接任或等恢复，没有“继续”', /允许 Sonnet 5.5 临时担任 PM/.test(pmBtns) && /等 Opus 5.5 恢复/.test(pmBtns) && !/继续/.test(pmBtns), pmBtns);
ok('等待老板时现状仍由应用生成，发给 PM 的消息会排队', /由应用根据台账生成，不依赖 PM/.test(f) && /PM 正在恢复，消息会排队/.test(await txt('.composer .to')));
await shot('pm-fault-ask', 'PM 不可用、没设替补、也没授权临时接任：授权内办法用完，才提出具体请求；现状照常由应用生成');
await choose('PMX', 'temp'); ok('允许后接任并继续', /Sonnet 5.5 已接任 PM/.test(await feed()));

// ======================================================================
G('其他模拟与面板');
await fresh(); await goto('s8', DEF);
ok('成员漏报：只补报告', await sim('silent') && /只补报告，不重做/.test(await feed()));
ok('PM 想放宽标准仍要老板批', await sim('weaken') && (await sid()) === 's8w' && (await needCount()) === 1);
await choose('WEAK', 'no'); ok('不批：标准不变', /3 秒/.test((await ledger()).crit.A2));
await goto('s9', DEF); ok('应用重启', await sim('restart') && /14:32 重启过/.test(await feed()));
await fresh(); await goto('s9', { ...DEF, D2: 'single' }); ok('图片形态影响后面的问题', /61 MB/.test(await feed()));
await click('[data-act="t2-tab"][data-v="seats"]'); const seats = await txt('#panel .pbody');
ok('成员页：可靠性四项分开，不作保证', /独立的对话/.test(seats) && /独立的工作区/.test(seats) && /检查由应用执行/.test(seats) && /来源不同不保证结论一定对/.test(seats) && /新的付费模型/.test(seats));
await page.evaluate(() => { S.team = freshTeam(); renderAll(); }); await page.keyboard.press('ArrowRight'); ok('方向键前进', (await sid()) === 's1');
await click('[data-act="t2-auto"]'); await sleep(2600 * 4 + 600); ok('自动播放停在第一个老板决定', (await sid()) === 's4');

R.checks = checks; R.errs = errs; R.fails = fails; R.passed = fails.length === 0 && errs.length === 0;
console.log(JSON.stringify(R, null, 1));
await page.close(); await browser.close();
