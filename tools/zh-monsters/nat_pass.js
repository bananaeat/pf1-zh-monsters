// 天生攻击伤害骰改成 sizeRoll：全量过合集包，改前改后掷一次伤害比公式（骰子和常数都要一样），再核对攻击补差。
// 用法（干净世界 GM 页面）：(await import("/zh-monsters/nat_pass.js?v=" + Date.now())).run("fix")，结果在 window.__nat 和 results_nat_<mode>.json
export async function run(mode = "dry") {
  const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
  const packs = game.packs.filter((p) => p.metadata.packageName === "pf1-zh-monsters" && p.documentName === "Actor");
  const S = (window.__nat = { mode, n: 0, total: 0, actors: 0, items: 0, mismatch: [], atk: [], err: [], done: false });
  for (const p of packs) S.total += (await p.getIndex()).size;
  const prog = async () => {
    const f = new File([JSON.stringify({ t: new Date().toISOString(), books: { ["天生攻击 sizeRoll " + mode]: { total: S.total, built: S.n, done: S.done, errors: S.err.length, bad: S.mismatch.length + S.atk.length } }, finished: S.done, err: null })], "progress.json", { type: "application/json" });
    await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  };
  const dmgOf = async (it) => {
    const r = await it.defaultAction.rollDamage({});
    // 公式文字里 sizeRoll 不展开，比实际掷的骰子和常数
    return (Array.isArray(r) ? r : [r]).map((x) => x ? x.dice.map((d) => d.number + "d" + d.faces).join("+") + " + " + (x.total - x.dice.reduce((t, d) => t + d.total, 0)) : "").join(" | ");
  };
  await prog();
  for (const pack of packs) {
    if (mode === "fix") await pack.configure({ locked: false });
    const ids = [...(await pack.getIndex())].map((e) => e._id);
    for (let s = 0; s < ids.length; s += 25) {
      for (const d of await pack.getDocuments({ _id__in: ids.slice(s, s + 25) })) {
        try {
          const ups = M.naturalSizeUpdates(d);
          if (ups.length) {
            S.actors++; S.items += ups.length;
            if (mode === "fix") {
              const before = new Map();
              for (const u of ups) before.set(u._id, await dmgOf(d.items.get(u._id)));
              await d.updateEmbeddedDocuments("Item", ups);
              for (const u of ups) {
                const it = d.items.get(u._id), after = await dmgOf(it);
                if (after !== before.get(u._id)) S.mismatch.push(`${d.name}：${it.name} ${before.get(u._id)} → ${after}`);
              }
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
  const f = new File([JSON.stringify(S, null, 1)], `results_nat_${mode}.json`, { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
