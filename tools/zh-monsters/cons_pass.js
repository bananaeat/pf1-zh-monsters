// 怪物身上的卷轴/魔杖/药水按补充合集包（已修好环级的版本）更新 actions 和说明；数量、剩余次数不动。
// 原来补充包建消耗品时没给环级，DC 成了「10 + undefined + NaN」（龙之欲 2026-10-28 发现）。先跑 syncSupplement({update: true})。
// 用法（干净世界 GM 页面）：(await import("/zh-monsters/cons_pass.js?v=" + Date.now())).run("fix")，结果在 window.__cons 和 results_cons_<mode>.json
export async function run(mode = "dry") {
  const packs = game.packs.filter((p) => p.metadata.packageName === "pf1-zh-monsters" && p.documentName === "Actor");
  const S = (window.__cons = { mode, n: 0, total: 0, items: 0, badBefore: 0, actors: 0, updated: 0, badAfter: [], noSource: [], err: [], done: false });
  for (const p of packs) S.total += (await p.getIndex()).size;
  const prog = async () => {
    const f = new File([JSON.stringify({ t: new Date().toISOString(), books: { ["消耗品 DC " + mode]: { total: S.total, built: S.n, done: S.done, errors: S.err.length, bad: S.badAfter.length + S.noSource.length } }, finished: S.done, err: null })], "progress.json", { type: "application/json" });
    await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  };
  const isBad = (i) => /undefined|NaN/.test(String(i.defaultAction?.save?.dc ?? ""));
  const supp = new Map((await game.packs.get("pf1-zh-monsters.supplement").getDocuments()).map((d) => [d.uuid, d]));
  await prog();
  for (const pack of packs) {
    if (mode === "fix") await pack.configure({ locked: false });
    const ids = [...(await pack.getIndex())].map((e) => e._id);
    for (let s = 0; s < ids.length; s += 25) {
      for (const d of await pack.getDocuments({ _id__in: ids.slice(s, s + 25) })) {
        try {
          const ups = [];
          for (const i of d.items) {
            if (i.type !== "consumable") continue;
            S.items++;
            if (isBad(i)) S.badBefore++;
            const src = i._stats?.compendiumSource;
            if (!src?.startsWith("Compendium.pf1-zh-monsters.supplement.")) continue;
            const sd = supp.get(src);
            if (!sd) { S.noSource.push(`${d.name}：${i.name} ${src}`); continue; }
            const sys = sd.toObject().system;
            if (JSON.stringify(sys.actions) === JSON.stringify(i.toObject().system.actions) && sys.description.value === i.system.description.value) continue;
            ups.push({ _id: i.id, "system.actions": sys.actions, "system.description.value": sys.description.value });
          }
          if (ups.length) {
            S.actors++; S.updated += ups.length;
            if (mode === "fix") await d.updateEmbeddedDocuments("Item", ups);
          }
          if (mode === "fix") for (const i of d.items) if (i.type === "consumable" && isBad(i)) S.badAfter.push(`${d.name}：${i.name}`);
        } catch (e) { S.err.push(`${d.name}: ${e.message}`); }
        S.n++;
      }
      await prog();
    }
    if (mode === "fix") await pack.configure({ locked: true });
  }
  S.done = true;
  await prog();
  const f = new File([JSON.stringify(S, null, 1)], `results_cons_${mode}.json`, { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
