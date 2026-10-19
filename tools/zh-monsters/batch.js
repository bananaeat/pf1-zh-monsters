// 整本批量：建角色（世界里临时文件夹）→ 逐把攻击正式使用核对 → 导入该书的合集包 → 删掉临时角色。
// 用法（GM 页面）：
//   const b = await import('/zh-monsters/batch.js?v=' + Date.now());
//   b.runAll();                      // 按 BOOKS 顺序跑完全部，进度在 window.__run
//   b.runAll({ only: ["怪物图鉴2"] });
let M = null;

export const BOOKS = [
  ["怪物图鉴", "pf1-zh-monsters.monsters"],
  ["怪物图鉴2", "pf1-zh-monsters.bestiary2"],
  ["怪物图鉴3", "pf1-zh-monsters.bestiary3"],
  ["怪物图鉴4", "pf1-zh-monsters.bestiary4"],
  ["怪物图鉴5", "pf1-zh-monsters.bestiary5"],
  ["怪物图鉴6", "pf1-zh-monsters.bestiary6"],
  ["NPC志", "pf1-zh-monsters.npc-codex"],
  ["怪物志", "pf1-zh-monsters.monster-codex"],
  ["*", "pf1-zh-monsters.other"], // 其余出处，按书分文件夹
];
export const CR_BUCKETS = [[0, 1, "CR 0–1"], [2, 3, "CR 2–3"], [4, 5, "CR 4–5"], [6, 7, "CR 6–7"], [8, 10, "CR 8–10"], [11, 14, "CR 11–14"],
  [15, 19, "CR 15–19"], [20, 99, "CR 20+"]];
const TMP = "批量（临时）";

const crOf = (a) => Number(a.system.details?.cr?.base ?? 0);
const num = (R) => (R ? R.total - R.dice.reduce((s, d) => s + d.total, 0) : null);

export async function verifyAttacks(actor) {
  const bad = [];
  const snap = actor.items.filter((i) => i.system.quantity != null).map((i) => ({ _id: i.id, "system.quantity": i.system.quantity }));
  for (const it of actor.items.filter((i) => i.flags["zh-monsters"]?.target)) {
    const t = it.flags["zh-monsters"].target;
    try {
      const before = new Set(game.messages.map((m) => m.id));
      const u = await it.use({ skipDialog: true });
      const msgs = game.messages.contents.filter((m) => !before.has(m.id));
      const at = msgs.at(-1)?.system?.rolls?.attacks?.[0];
      const got = [num(at?.attack), num(at?.damage?.[0])];
      if (got[0] !== t.bonus[0] || (got[1] != null && got[1] !== t.dmgBonus)) bad.push({ item: it.name, want: [t.bonus[0], t.dmgBonus], got, code: u?.code });
      for (const m of msgs) await m.delete();
    } catch (e) { bad.push({ item: it.name, err: e.message }); }
  }
  if (snap.length) await actor.updateEmbeddedDocuments("Item", snap);
  return bad;
}

async function importBook(actors, packId, book, bySource) {
  const pack = game.packs.get(packId);
  await pack.configure({ locked: false });
  const folders = {};
  for (const f of pack.folders) folders[f.name] = f.id;
  const need = bySource ? [...new Set(actors.map((a) => a.flags["zh-monsters"]?.source || "未知出处"))].sort((a, b) => a.localeCompare(b, "zh"))
    : CR_BUCKETS.map((b) => b[2]);
  const make = need.filter((n) => !folders[n]);
  if (make.length) {
    const made = await Folder.createDocuments(make.map((n, i) => ({ name: n, type: "Actor", sorting: bySource ? "a" : "m", sort: (need.indexOf(n) + 1) * 100 })), { pack: packId });
    for (const f of made) folders[f.name] = f.id;
  }
  // 重跑：一个合集包只放一本书（或「其他出处」整组），先清空
  const old = (await pack.getIndex()).map((e) => e._id);
  for (let i = 0; i < old.length; i += 200) await Actor.deleteDocuments(old.slice(i, i + 200), { pack: packId });
  actors.sort((x, y) => crOf(x) - crOf(y) || x.name.localeCompare(y.name, "zh"));
  const datas = actors.map((a, i) => {
    const d = a.toObject();
    delete d._id;
    const c = crOf(a);
    d.folder = bySource ? folders[a.flags["zh-monsters"]?.source || "未知出处"] : folders[(CR_BUCKETS.find(([lo, hi]) => c <= hi) || CR_BUCKETS.at(-1))[2]];
    d.sort = (i + 1) * 10;
    d.ownership = { default: 0 };
    return d;
  });
  for (let i = 0; i < datas.length; i += 40) await Actor.createDocuments(datas.slice(i, i + 40), { pack: packId });
  await pack.configure({ locked: true });
  return datas.length;
}

export async function runAll({ only = null, skipVerify = false } = {}) {
  M = await import("./build_actor.js?v=" + Date.now());
  const plans = await fetch("/zh-monsters/plans_all.json?" + Date.now()).then((r) => r.json());
  const known = new Set(BOOKS.map((b) => b[0]));
  const R = (window.__run = window.__run || { books: {}, log: [] });
  R.started = Date.now();
  for (const [book, packId] of BOOKS) {
    if (only && !only.includes(book)) continue;
    if (R.books[book]?.done && !only) continue;
    const list = plans.filter((p) => (book === "*" ? !known.has(p.source) : p.source === book));
    const st = (R.books[book] = { total: list.length, built: 0, errors: [], bad: [], atkBad: [], done: false, t0: Date.now() });
    let folder = game.folders.find((f) => f.name === TMP && f.type === "Actor");
    if (folder) { await Actor.deleteDocuments(game.actors.filter((a) => a.folder?.id === folder.id).map((a) => a.id)); }
    else folder = await Folder.create({ name: TMP, type: "Actor" });
    const actors = [];
    for (const p of list) {
      try {
        const r = (await M.buildAll([p], folder.id))[0];
        const a = game.actors.get(r.id);
        if (a) {
          await a.update({ "flags.zh-monsters.source": p.source || "未知出处", "flags.zh-monsters.page": p.page || null });
          actors.push(a);
        }
        if (r.bad?.length) st.bad.push({ name: p.name, bad: r.bad });
        st.log = (st.log || 0) + (r.log?.length || 0);
        (R.logs = R.logs || {})[`${book}|${p.name}`] = r.log;
      } catch (e) { st.errors.push({ name: p.name, err: e.message }); }
      st.built++;
    }
    if (!skipVerify) for (const a of actors) { const b = await verifyAttacks(a); if (b.length) st.atkBad.push({ name: a.name, bad: b }); }
    st.imported = await importBook(actors, packId, book, book === "*");
    await Actor.deleteDocuments(actors.map((a) => a.id));
    st.done = true;
    st.sec = Math.round((Date.now() - st.t0) / 1000);
  }
  R.finished = true;
  return R;
}

// 只重建几只并替换合集包里的同名条目：b.fixup([{ name: "链魔", source: "怪物图鉴" }, ...])
export async function fixup(list) {
  M = await import("./build_actor.js?v=" + Date.now());
  const plans = await fetch("/zh-monsters/plans_all.json?" + Date.now()).then((r) => r.json());
  const known = new Map(BOOKS.map((b) => [b[0], b[1]]));
  let folder = game.folders.find((f) => f.name === TMP && f.type === "Actor") || (await Folder.create({ name: TMP, type: "Actor" }));
  const out = [];
  for (const { name, source, en } of list) {
    // 同出处可能有两个同中文名的（路霸 = Street Thug / Highwayman），给了英文名就按英文名找
    const p = plans.find((x) => x.name === name && (!source || x.source === source) && (!en || x.en === en));
    if (!p) { out.push({ name, err: "没有计划" }); continue; }
    const packId = known.get(p.source) || "pf1-zh-monsters.other";
    const r = (await M.buildAll([p], folder.id))[0];
    const a = game.actors.get(r.id);
    await a.update({ "flags.zh-monsters.source": p.source || "未知出处", "flags.zh-monsters.page": p.page || null });
    const atk = await verifyAttacks(a);
    const pack = game.packs.get(packId);
    await pack.configure({ locked: false });
    const idx = await pack.getIndex({ fields: ["folder", "sort", "flags.zh-monsters.source"] });
    // 按名字和出处找：「其他出处」包里有同名不同书的（海盗船长：游戏主持人指南 / Isles of the Shackles），只按名字会覆盖掉另一本的
    const old = idx.find((e) => e.name === a.name && (e.flags?.["zh-monsters"]?.source ?? null) === (p.source || "未知出处"));
    const d = a.toObject();
    delete d._id;
    d.folder = old?.folder ?? null;
    d.sort = old?.sort ?? 0;
    d.ownership = { default: 0 };
    if (old) await Actor.deleteDocuments([old._id], { pack: packId });
    await Actor.createDocuments([d], { pack: packId });
    await pack.configure({ locked: true });
    await a.delete();
    out.push({ name: a.name, pack: packId, replaced: !!old, bad: r.bad, atkBad: atk });
  }
  return out;
}

// 建完但没导入就断了（页面被关）：把临时文件夹里已建好的角色核对攻击、导入合集包、删掉临时角色
// b.importTemp("*") 或 b.importTemp("怪物图鉴6")
export async function importTemp(book, { skipVerify = false } = {}) {
  const packId = new Map(BOOKS.map((b) => [b[0], b[1]])).get(book);
  const folder = game.folders.find((f) => f.name === TMP && f.type === "Actor");
  const actors = game.actors.filter((a) => a.folder?.id === folder?.id);
  const R = (window.__run = window.__run || { books: {}, log: [] });
  const st = (R.books[book] = { total: actors.length, built: actors.length, verified: 0, errors: [], bad: [], atkBad: [], done: false, t0: Date.now() });
  if (!skipVerify) for (const a of actors) { const b = await verifyAttacks(a); if (b.length) st.atkBad.push({ name: a.name, bad: b }); st.verified++; }
  st.imported = await importBook(actors, packId, book, book === "*");
  await Actor.deleteDocuments(actors.map((a) => a.id));
  st.done = true;
  R.finished = true;
  return st;
}
