// 跟维基更新：按 delta 文件（plans 新旧对比：added / changed / removed）重建有改动的怪、补上新怪、删掉维基上没了的（多是改名）。
// 先同步补充合集包。只在干净世界（zhm-release-test）里跑。进度写 progress.json，结果写 results_sync_<delta>.json，也在 window.__sync。
// 用法（GM 页面）：(await import("/zh-monsters/wiki_sync.js?v=" + Date.now())).run("delta_1019.json")
export async function run(deltaFile) {
  const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
  const B = await import("/zh-monsters/batch.js?v=" + Date.now());
  const delta = await (await fetch(`/zh-monsters/${deltaFile}?${Date.now()}`)).json();
  const plans = await (await fetch("/zh-monsters/plans_all.json?" + Date.now())).json();
  const P = new Map(plans.map((p) => [`${p.name}|${p.en}|${p.source}`, p]));
  const known = new Map(B.BOOKS.map((b) => [b[0], b[1]]));
  const packOf = (source) => known.get(source) || "pf1-zh-monsters.other";
  const actorName = (name, en) => `${name} (${en})`;
  const todo = [...delta.changed, ...delta.added].map(([n, e, s]) => P.get(`${n}|${e}|${s}`));
  const S = (window.__sync = { total: todo.length + delta.removed.length, n: 0, supp: null, removed: 0, replaced: 0, added: 0, bad: [], atkBad: [], err: [], done: false });
  const prog = async () => {
    const f = new File([JSON.stringify({ t: new Date().toISOString(), books: { 跟维基更新: { total: S.total, built: S.n, done: S.done, errors: S.err.length, bad: S.bad.length + S.atkBad.length } }, finished: S.done, err: null })], "progress.json", { type: "application/json" });
    await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  };
  await prog();
  S.supp = await M.syncSupplement();

  // 合集包索引（带出处，「其他出处」包里可能有同名不同书的）
  const idx = {};
  const index = async (packId) => (idx[packId] ??= [...(await game.packs.get(packId).getIndex({ fields: ["folder", "sort", "flags.zh-monsters.source"] }))]);
  const find = async (name, en, source) => (await index(packOf(source))).find((e) => e.name === actorName(name, en) && (e.flags?.["zh-monsters"]?.source ?? null) === source);

  for (const [name, en, source] of delta.removed) {
    try {
      const packId = packOf(source);
      const e = await find(name, en, source);
      if (e) {
        await game.packs.get(packId).configure({ locked: false });
        await Actor.deleteDocuments([e._id], { pack: packId });
        idx[packId] = idx[packId].filter((x) => x._id !== e._id);
        S.removed++;
      } else S.err.push(`删除：合集包里没找到 ${name}（${source}）`);
    } catch (e) { S.err.push(`删除 ${name}: ${e.message}`); }
    S.n++;
  }
  await prog();

  const tmp = game.folders.find((f) => f.name === "批量（临时）" && f.type === "Actor") || (await Folder.create({ name: "批量（临时）", type: "Actor" }));
  for (const p of todo) {
    try {
      const packId = packOf(p.source);
      const pack = game.packs.get(packId);
      const r = (await M.buildAll([p], tmp.id))[0];
      const a = game.actors.get(r.id);
      await a.update({ "flags.zh-monsters.source": p.source || "未知出处", "flags.zh-monsters.page": p.page || null });
      const atk = await B.verifyAttacks(a);
      if (r.bad?.length) S.bad.push(`${a.name}：${r.bad.slice(0, 4).join("；")}`);
      if (atk.length) S.atkBad.push(`${a.name}：${atk.slice(0, 3).map((x) => `${x.item} ${x.err ?? `要 ${x.want} 得 ${x.got}`}`).join("；")}`);
      // 文件夹：替换的沿用原来的；新的按 CR（「其他出处」包按书）
      const old = await find(p.name, p.en, p.source);
      let folder = old?.folder ?? null;
      if (!old) {
        const fname = packId.endsWith(".other") ? p.source || "未知出处" : (B.CR_BUCKETS.find(([lo, hi]) => Number(a.system.details?.cr?.base ?? 0) <= hi) || B.CR_BUCKETS.at(-1))[2];
        folder = pack.folders.find((f) => f.name === fname)?.id;
        if (!folder) {
          await pack.configure({ locked: false });
          folder = (await Folder.create({ name: fname, type: "Actor", sorting: "m" }, { pack: packId })).id;
        }
      }
      const d = a.toObject();
      delete d._id;
      d.folder = folder;
      d.sort = old?.sort ?? 0;
      d.ownership = { default: 0 };
      await pack.configure({ locked: false });
      if (old) {
        await Actor.deleteDocuments([old._id], { pack: packId });
        idx[packId] = idx[packId].filter((x) => x._id !== old._id);
        S.replaced++;
      } else S.added++;
      const [made] = await Actor.createDocuments([d], { pack: packId });
      idx[packId].push({ _id: made.id, name: made.name, folder, sort: d.sort, flags: { "zh-monsters": { source: p.source } } });
      await a.delete();
    } catch (e) { S.err.push(`${p.name}（${p.source}）: ${e.message}`); }
    S.n++;
    if (S.n % 10 === 0) await prog();
  }
  for (const id of Object.keys(idx)) await game.packs.get(id).configure({ locked: true });
  S.done = true;
  await prog();
  const f = new File([JSON.stringify(S, null, 1)], `results_sync_${deltaFile}`, { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
