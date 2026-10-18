// 修已导入合集里的重复标识符（2026-10-17）
// 1. 能力类物品的标识符由中文名生成，只剩「ex」「su」之类，同一只怪里撞车：按 build_actor.js 的 assignTags 规则改成唯一的。不影响数值。
// 2. 职业自动带的职业特性和属性块里的那条重复（classFeat_xxx 两份）：只记下来，交给 batch.js 的 fixup 重建（删掉会改数值）。
const PACKS = ["monsters", "bestiary2", "bestiary3", "bestiary4", "bestiary5", "bestiary6", "npc-codex", "monster-codex", "other"].map((k) => "pf1-zh-monsters." + k);

function enOf(i) {
  return i.flags?.babele?.originalName || /\(([A-Za-z][^()]*)\)\s*$/.exec(i.name)?.[1];
}

async function newTag(i, used) {
  let en = enOf(i);
  const src = i._stats?.compendiumSource;
  if (!en && src) en = enOf((await fromUuid(src).catch(() => null)) || { name: "" });
  let t = en ? pf1.utils.createTag(en.replace(/\s*\[[^\]]*\]/g, "")) : "";
  if (!t || t.length < 3) {
    let h = 0;
    for (const ch of i.name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    t = (t || "zh") + h.toString(36);
  }
  let u = t;
  for (let k = 2; used.has(u); k++) u = t + k;
  used.add(u);
  return u;
}

export async function run({ dry = false, packs = PACKS } = {}) {
  const st = (window.__rt = { done: false, n: 0, retagged: 0, actors: 0, rebuild: [], err: [] });
  for (const key of packs) {
    const pack = game.packs.get(key);
    const wasLocked = pack.locked;
    if (!dry && wasLocked) await pack.configure({ locked: false });
    const ids = [...(await pack.getIndex())].map((x) => x._id);
    for (let s = 0; s < ids.length; s += 40) {
      const docs = await pack.getDocuments({ _id__in: ids.slice(s, s + 40) });
      for (const a of docs) {
        st.n++;
        try {
          const items = a.items.filter((i) => i.type === "feat" || i.type === "attack");
          const by = {};
          for (const i of items) if (i.system?.tag) (by[i.system.tag] = by[i.system.tag] || []).push(i);
          // 职业特性重复：一份是我们的（mine），一份是职业自动带的
          const cf = Object.entries(by).filter(([, l]) => l.length > 1 && l.some((i) => i.flags?.["zh-monsters"]?.mine) && l.some((i) => !i.flags?.["zh-monsters"]?.mine));
          if (cf.length) st.rebuild.push({ name: a.name.replace(/\s*\([^()]*\)\s*$/, ""), source: a.flags?.["zh-monsters"]?.source, pack: key, tags: cf.map(([t]) => t) });
          const used = new Set();
          const upd = [];
          for (const i of items) {
            const t = i.system?.tag;
            if (t && cf.some(([x]) => x === t)) continue; // 职业特性重复的留给重建
            if (t && t.length >= 3 && !used.has(t)) { used.add(t); continue; }
            upd.push({ _id: i.id, "system.tag": await newTag(i, used) });
          }
          if (upd.length) {
            st.actors++;
            st.retagged += upd.length;
            if (!dry) await a.updateEmbeddedDocuments("Item", upd);
          }
        } catch (e) {
          st.err.push(`${a.name}: ${e.message}`);
        }
      }
    }
    if (!dry && wasLocked) await pack.configure({ locked: true });
  }
  st.done = true;
  return st;
}
