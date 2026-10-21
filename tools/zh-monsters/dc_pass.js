// 能力 DC 改成公式：全量过合集包。dry 只统计；fix 写入，并核对每个动作改前改后的 DC 一样。
// 用法（干净世界 GM 页面）：(await import("/zh-monsters/dc_pass.js?v=" + Date.now())).run("dry")，结果在 window.__dc 和 results_dc_<mode>.json
export async function run(mode = "dry") {
  const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
  const packs = game.packs.filter((p) => p.metadata.packageName === "pf1-zh-monsters" && p.documentName === "Actor");
  const S = (window.__dc = { mode, n: 0, total: 0, actors: 0, items: 0, skipped: {}, mismatch: [], err: [], done: false });
  for (const p of packs) S.total += (await p.getIndex()).size;
  const prog = async () => {
    const f = new File([JSON.stringify({ t: new Date().toISOString(), books: { ["DC 公式 " + mode]: { total: S.total, built: S.n, done: S.done, errors: S.err.length, bad: S.mismatch.length } }, finished: S.done, err: null })], "progress.json", { type: "application/json" });
    await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  };
  const dcs = (actor) => [...actor.items].flatMap((it) => (it.actions?.contents ?? []).filter((a) => a.save?.type).map((a) => [it.id, a.id, it.name, a.getDC()]));
  await prog();
  for (const pack of packs) {
    if (mode === "fix") await pack.configure({ locked: false });
    const ids = [...(await pack.getIndex())].map((e) => e._id);
    for (let s = 0; s < ids.length; s += 25) {
      for (const d of await pack.getDocuments({ _id__in: ids.slice(s, s + 25) })) {
        try {
          const { updates, skipped } = M.dcFormulaUpdates(d);
          for (const x of skipped) { const k = x.replace(/\s*DC.*$/, "").replace(/[（(].*$/, ""); S.skipped[k] = (S.skipped[k] || 0) + 1; }
          if (updates.length) {
            S.actors++; S.items += updates.length;
            if (mode === "fix") {
              const before = new Map(dcs(d).map(([i, a, n, v]) => [i + a, [n, v]]));
              await d.updateEmbeddedDocuments("Item", updates);
              for (const [i, a, n, v] of dcs(d)) { const b = before.get(i + a); if (b && b[1] !== v) S.mismatch.push(`${d.name}：${n} ${b[1]} → ${v}`); }
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
  S.skipped = Object.fromEntries(Object.entries(S.skipped).sort((a, b) => b[1] - a[1]));
  const f = new File([JSON.stringify(S, null, 1)], `results_dc_${mode}.json`, { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
