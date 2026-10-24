// 非中型生物持有的武器、护甲、衣物改成生物自己的体型。改完核对 AC、CMD、豁免、先攻和攻击，确认数值没变（负重可能变）。
// 用法（干净世界 GM 页面）：(await import("/zh-monsters/size_pass.js?v=" + Date.now())).run("fix")，结果在 window.__sz 和 results_size_<mode>.json
export async function run(mode = "dry") {
  const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
  const packs = game.packs.filter((p) => p.metadata.packageName === "pf1-zh-monsters" && p.documentName === "Actor");
  const S = (window.__sz = { mode, n: 0, total: 0, actors: 0, items: 0, changed: [], atk: [], err: [], done: false });
  for (const p of packs) S.total += (await p.getIndex()).size;
  const prog = async () => {
    const f = new File([JSON.stringify({ t: new Date().toISOString(), books: { ["装备体型 " + mode]: { total: S.total, built: S.n, done: S.done, errors: S.err.length, bad: S.changed.length + S.atk.length } }, finished: S.done, err: null })], "progress.json", { type: "application/json" });
    await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  };
  const stats = (a) => { const A = a.system.attributes; return JSON.stringify([A.ac.normal.total, A.ac.touch.total, A.ac.flatFooted.total, A.cmd.total, A.cmb.total, A.init.total, A.savingThrows.fort.total, A.savingThrows.ref.total, A.savingThrows.will.total, A.hp.max]); };
  await prog();
  for (const pack of packs) {
    if (mode === "fix") await pack.configure({ locked: false });
    const ids = [...(await pack.getIndex())].map((e) => e._id);
    for (let s = 0; s < ids.length; s += 25) {
      for (const d of await pack.getDocuments({ _id__in: ids.slice(s, s + 25) })) {
        try {
          const sz = d.system.traits.size?.base ?? d.system.traits.size;
          const ups = sz && sz !== "med" ? d.items.filter((i) => ["weapon", "equipment"].includes(i.type) && i.system.size && i.system.size !== sz).map((i) => ({ _id: i.id, "system.size": sz })) : [];
          if (ups.length) {
            S.actors++; S.items += ups.length;
            if (mode === "fix") {
              const before = stats(d);
              await d.updateEmbeddedDocuments("Item", ups);
              const after = stats(d);
              if (before !== after) S.changed.push(`${d.name}：${before} → ${after}`);
              const bad = await M.attackAdjust(d, [], { dry: true });
              if (bad.length) S.atk.push(`${d.name}：${bad.join("；")}`);
            }
          }
        } catch (e) { S.err.push(`${d.name}: ${e.message}`); }
        S.n++;
      }
      await prog();
    }
    if (mode === "fix") await pack.configure({ locked: true });
  }
  S.done = true;
  await prog();
  const f = new File([JSON.stringify(S, null, 1)], `results_size_${mode}.json`, { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
