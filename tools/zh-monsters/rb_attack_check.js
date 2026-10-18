// 在装着 Roll Bonuses 的世界里核对有武器娴熟的怪（fincand.json）：每个攻击按属性块核对（rollAttack 会走 Roll Bonuses 的替换钩子），只读不改。
// 用法（GM 页面）：(await import("/zh-monsters/rb_attack_check.js?v=" + Date.now())).run()，结果在 window.__rbatk
export async function run() {
  const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
  const cand = await (await fetch("/zh-monsters/fincand.json?" + Date.now())).json();
  const S = (window.__rbatk = { rb: !!game.modules.get("ckl-roll-bonuses")?.active, n: 0, total: cand.length, bad: [], err: [], done: false });
  for (const c of cand) {
    try {
      const a = await game.packs.get("pf1-zh-monsters." + c.pack).getDocument(c.id);
      const bad = await M.attackAdjust(a, [], { dry: true });
      if (bad.length) S.bad.push(a.name + "：" + bad.join("；"));
    } catch (e) { S.err.push(c.name + ": " + e.message); }
    S.n++;
  }
  S.done = true;
  const f = new File([JSON.stringify(S, null, 1)], "results_rb_attack.json", { type: "application/json" });
  await FilePicker.upload("data", "zh-monsters", f, {}, { notify: false });
  return S;
}
