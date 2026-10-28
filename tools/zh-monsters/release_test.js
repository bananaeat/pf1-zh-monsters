// 发布前的干净世界测试：每个合集包随机抽几只拖进世界，核对数值（HP、AC、豁免、BAB、CMB/CMD、先攻、能力值、施法者等级、专注、法术 DC），
// 用一次攻击、施一个有豁免的法术，记下控制台报错。用法（GM 页面）：(await import("/zh-monsters/release_test.js")).run("A")
export async function run(label, n = 30) {
  const errs = [];
  const oe = console.error;
  console.error = (...a) => { errs.push(a.map(String).join(" ").slice(0, 200)); oe(...a); };
  const onErr = (e) => errs.push(String(e.message).slice(0, 200));
  window.addEventListener("error", onErr);
  try {
    const plans = await (await fetch("/zh-monsters/plans_all.json?" + Date.now())).json();
    const P = new Map(plans.map((p) => [p.name + " (" + p.en + ")|" + p.source, p]));
    const M = await import("/zh-monsters/build_actor.js?v=" + Date.now());
    const packs = game.packs.filter((p) => p.metadata.packageName === "pf1-zh-monsters" && p.documentName === "Actor");
    let seed = [...label].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) % 2147483647 || 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const picks = [];
    while (picks.length < n) {
      const p = packs[Math.floor(rnd() * packs.length)];
      const idx = [...(await p.getIndex())];
      picks.push([p, idx[Math.floor(rnd() * idx.length)]]);
    }
    const out = [];
    for (const [p, e] of picks) {
      const src = await p.getDocument(e._id);
      const [a] = await Actor.createDocuments([src.toObject()]);
      const pl0 = P.get(a.name + "|" + a.flags?.["zh-monsters"]?.source);
      const pl = pl0 && M.spellTargets(pl0); // 法术 AC 做成关着的增益，按不开增益的数核对
      const A = a.system.attributes;
      const bad = [];
      if (pl) {
        const chk = { hp: [A.hp.max, pl.hp.total], ac: [A.ac.normal.total, pl.ac.normal], fort: [A.savingThrows.fort.total, pl.saves.fort],
          ref: [A.savingThrows.ref.total, pl.saves.ref], will: [A.savingThrows.will.total, pl.saves.will], bab: [A.bab.total, pl.bab],
          cmb: [A.cmb.total, pl.cmb], cmd: [A.cmd.total, pl.cmd], init: [A.init.total, pl.init] };
        for (const [k, [x, y]] of Object.entries(chk)) if (y != null && x !== y) bad.push(`${k} ${x}≠${y}`);
        for (const [k, v] of Object.entries(pl.abilities)) if (v != null && a.system.abilities[k].total !== v) bad.push(`${k} ${a.system.abilities[k].total}≠${v}`);
        bad.push(...M.spellCheck(a, pl));
      } else bad.push("没有计划");
      const before = new Set(game.messages.map((m) => m.id));
      let atk = null, spell = null;
      const w = a.items.find((i) => ["attack", "weapon"].includes(i.type) && i.system.actions?.length && (i.type !== "weapon" || i.system.showInCombat));
      if (w) {
        try {
          await w.use({ skipDialog: true });
          const m = game.messages.contents.filter((x) => !before.has(x.id)).at(-1);
          atk = m?.system?.rolls?.attacks?.[0]?.attack?.total ?? (m ? "卡片" : "无");
        } catch (err) { atk = "错误 " + err.message; }
      }
      // 有范围模板的法术会等人在地图上放模板，测试里跳过
      const sp = a.items.find((i) => i.type === "spell" && (i.defaultAction ?? i.firstAction)?.save?.type && !(i.defaultAction ?? i.firstAction)?.measureTemplate?.type);
      if (sp) {
        try {
          await sp.use({ skipDialog: true });
          const act = sp.defaultAction ?? sp.firstAction;
          spell = `${sp.name.replace(/ \(.*/, "")} DC${act.getDC()} 持续${act.duration?.value ?? ""}/${act.duration?.units ?? ""}`;
        } catch (err) { spell = "错误 " + err.message; }
      }
      for (const m of game.messages.contents.filter((x) => !before.has(x.id))) await m.delete();
      out.push({ 名字: a.name, 合集包: p.metadata.label, 种族: a.race?.name, 核对: bad.join("；") || "一致", 攻击: atk, 法术: spell });
      await a.delete();
    }
    return { label, 模组: [...game.modules.values()].filter((m) => m.active).map((m) => m.id), 抽查: out.length,
      不一致: out.filter((o) => o.核对 !== "一致").length, 报错: [...new Set(errs)].slice(0, 12), out };
  } finally {
    console.error = oe;
    window.removeEventListener("error", onErr);
  }
}
