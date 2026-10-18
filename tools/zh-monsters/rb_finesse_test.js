// Roll Bonuses 的「武器娴熟」会把攻击公式里的力量换成敏捷。核对：建出怪物，正式使用一次天然/灵巧攻击，攻击加值和属性块比。
// 用法（GM 页面）：(await import("/zh-monsters/rb_finesse_test.js?v=" + Date.now())).run(20)，结果在 window.__rbfin
export async function run(n = 20, { onlyDexGreater = true } = {}) {
  const S = (window.__rbfin = { done: false, rb: !!game.modules.get("ckl-roll-bonuses")?.active, out: [], err: [] });
  const cand = await (await fetch("/zh-monsters/fincand.json?" + Date.now())).json();
  CONFIG.sounds.dice = null;
  for (const c of cand) {
    if (S.out.length >= n) break;
    try {
      const pack = game.packs.get("pf1-zh-monsters." + c.pack);
      const src = await pack.getDocument(c.id);
      const ab = src.system.abilities;
      if (onlyDexGreater && ab.dex.mod <= ab.str.mod) continue;
      const [a] = await Actor.createDocuments([src.toObject()]);
      const items = a.items.filter((i) => ["attack", "weapon"].includes(i.type) && i.flags?.["zh-monsters"]?.target
        && (i.system.subType === "natural" || i.system.weaponGroups?.total?.has?.("natural") || i.system.properties?.fin));
      for (const it of items) {
        const before = new Set(game.messages.map((m) => m.id));
        await it.use({ skipDialog: true });
        const m = game.messages.contents.filter((x) => !before.has(x.id)).at(-1);
        const atk = m?.system?.rolls?.attacks?.[0]?.attack;
        const d20 = atk?.dice?.[0]?.total ?? 0;
        S.out.push({ 名字: a.name, 攻击: it.name, 属性: it.defaultAction?.ability?.attack, 敏: a.system.abilities.dex.mod, 力: a.system.abilities.str.mod,
          属性块: it.flags["zh-monsters"].target.bonus[0], 实际: atk ? atk.total - d20 : null, 公式: atk?.formula });
        for (const x of game.messages.contents.filter((x) => !before.has(x.id))) await x.delete();
      }
      await a.delete();
    } catch (e) { S.err.push(c.name + ": " + e.message); }
  }
  S.bad = S.out.filter((o) => o.实际 !== o.属性块).length;
  S.done = true;
  return S;
}
