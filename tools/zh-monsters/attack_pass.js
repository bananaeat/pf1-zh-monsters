// 在干净世界（zhm-release-test）里全量过一遍攻击：dry 只核对，fix 先把武器娴熟的攻击改用敏捷、补上 Roll Bonuses 的键，再按属性块重新补差，最后再核对一次。
// 用法（GM 页面）：(await import("/zh-monsters/attack_pass.js?v=" + Date.now())).run("dry")，进度写 progress.json，结果写 results_attack_<mode>.json，也在 window.__atk
export async function run(mode = "dry", { only = null } = {}) { // only：只过 fincand.json 里的怪（有武器娴熟的）
  const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
  const packs = game.packs.filter((p) => p.metadata.packageName === "pf1-zh-monsters" && p.documentName === "Actor");
  const S = (window.__atk = { mode, n: 0, total: 0, actors: 0, finActors: 0, finItems: 0, rbKeyed: 0, fixedActors: 0, before: [], after: [], err: [], done: false });
  const pick = only ? new Set((await (await fetch("/zh-monsters/" + only + "?" + Date.now())).json()).map((c) => c.id)) : null;
  for (const p of packs) S.total += pick ? [...(await p.getIndex())].filter((e) => pick.has(e._id)).length : (await p.getIndex()).size;
  const prog = async () => {
    const f = new File([JSON.stringify({ t: new Date().toISOString(), books: { ["攻击核对 " + mode]: { total: S.total, built: S.n, done: S.done, errors: S.err.length, bad: S.before.length } }, finished: S.done, err: null })], "progress.json", { type: "application/json" });
    await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  };
  await prog();
  for (const pack of packs) {
    const ids = [...(await pack.getIndex())].map((e) => e._id).filter((id) => !pick || pick.has(id));
    if (!ids.length) continue;
    if (mode === "fix") await pack.configure({ locked: false });
    for (let s = 0; s < ids.length; s += 25) {
      const docs = await pack.getDocuments({ _id__in: ids.slice(s, s + 25) });
      for (const d of docs) {
        try {
          S.actors++;
          const bad = await M.attackAdjust(d, [], { dry: true });
          if (bad.length) S.before.push(d.name + "：" + bad.slice(0, 4).join("；"));
          if (mode === "fix") {
            const keyed = [];
            for (const i of d.items) {
              const o = i.toObject();
              if (M.rbKeys(o) && JSON.stringify(o.system.flags.boolean) !== JSON.stringify(i.system.flags?.boolean ?? {})) keyed.push({ _id: i.id, "system.flags.boolean": o.system.flags.boolean });
            }
            if (keyed.length) { await d.updateEmbeddedDocuments("Item", keyed); S.rbKeyed += keyed.length; }
            const fin = M.finesseDexUpdates(d);
            if (fin.length) { await d.updateEmbeddedDocuments("Item", fin); S.finActors++; S.finItems += fin.length; }
            if (fin.length || bad.length) {
              await M.attackAdjust(d, []);
              S.fixedActors++;
              const left = await M.attackAdjust(d, [], { dry: true });
              if (left.length) S.after.push(d.name + "：" + left.slice(0, 4).join("；"));
            }
          } else if (M.finesseDexUpdates(d).length) S.finActors++;
        } catch (e) { S.err.push(d.name + ": " + e.message); }
        S.n++;
      }
      await prog();
    }
    if (mode === "fix") await pack.configure({ locked: true });
  }
  S.done = true;
  await prog();
  const f = new File([JSON.stringify(S, null, 1)], `results_attack_${mode}${only ? "_" + only.replace(".json", "") : ""}.json`, { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
