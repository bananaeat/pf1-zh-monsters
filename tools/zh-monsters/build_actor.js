// 按 plan.py 生成的计划在 Foundry 里搭 PF1 怪物角色：
// 专长、法术、天生攻击、怪物能力、种族生命骰、职业都从已有合集包复制（带 compendiumSource），
// 让 PF1 自己算 HP/AC/豁免/攻击，再和属性块比对，差值写进一个「属性块修正」能力里。
// 用法（GM 页面）：const m = await import("/zh-monsters/build_actor.js?v=1"); await m.buildAll(plans, folderId)

const ADJ_NAME = "属性块修正";

async function fromC(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return null;
  const d = doc.toObject();
  delete d._id;
  d._stats = { ...(d._stats || {}), compendiumSource: uuid };
  return d;
}

// 分数 CR 用 PF1 自己的写法（1/3 = 0.3375、1/6 = 0.1625），角色卡才显示「1/3」，经验值也按表算（135 而不是 133）
function crValue(cr) {
  if (!cr) return 0;
  return pf1.utils.CR.fromString(String(cr).trim()) || 0;
}

function langKeys(text) {
  const inv = {};
  for (const [k, v] of Object.entries(pf1.config.languages)) inv[v] = k;
  const keys = [], custom = [];
  for (const part of (text || "").split(/[;；，,]/).map((s) => s.trim()).filter(Boolean)) {
    if (inv[part]) keys.push(inv[part]);
    else custom.push(part);
  }
  return { keys, custom };
}

// 免疫拆成伤害免疫（di）、状态免疫（ci）、易伤（dv）、能量抗力（eres）、伤害减免（dr）；拆不出来的写进对应栏的自定义文字
function defenseTraits(d) {
  d = d || { di: [], ci: [], dv: [], eres: [], dr: [], notes: [] };
  const pick = (prefix) => d.notes.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)).join("；");
  return {
    di: d.di, ci: d.ci,
    dv: [...d.dv, ...d.notes.filter((n) => n.startsWith("弱点：")).map((n) => n.slice(3))],
    eres: { value: d.eres, custom: pick("抗力：") },
    dr: { value: d.dr, custom: pick("伤害减免：") },
    cres: "",
  };
}

// ---- 种族 ----
// 属性块的生物类型 / 子类用词和 PF1 的不完全一样（跨位面 = 异界、水栖 = 水生、龙类 = 龙），先按这张表，再按系统自己的中文名
const TYPE_KEY = { 异怪: "aberration", 动物: "animal", 构装体: "construct", 龙类: "dragon", 龙: "dragon", 精类: "fey", 类人生物: "humanoid",
  魔法兽: "magicalBeast", 人形怪物: "monstrousHumanoid", 泥形生物: "ooze", 泥怪: "ooze", 异界生物: "outsider", 植物: "plant",
  不死生物: "undead", 虫类: "vermin" };
const SUB_KEY = { 跨位面: "extraplanar", 跨位面子类: "extraplanar", 水栖: "aquatic", 水生: "aquatic", 火系: "fire", 火焰: "fire", 土系: "earth",
  土: "earth", 水系: "water", 水: "water", 气系: "air", 气: "air", 寒系: "cold", 寒冷: "cold", 变形: "shapechanger", 变形者: "shapechanger",
  本地: "native", 原生: "native", 巨人: "giant", 爬虫: "reptilian", 爬虫类: "reptilian", 发条: "clockwork", 发条生物: "clockwork", 机体: "robot",
  部队: "troop", 混沌: "chaotic", 混乱: "chaotic", 守序: "lawful", 圣使: "archon", 神使: "herald", 灵使: "azata", 福使: "agathion",
  恐亡魔: "sahkil", 妖灵: "div", 渡魂使: "psychopomp", 古魔: "qlippoth", 链魔: "kyton", 恶鬼: "oni", 神灵: "kami", 莱西: "leshy",
  魔孽: "demodand", 荒疫怪: "blight", 幽暗之民: "darkFolk", 德洛人: "derro", 比蒙巨兽: "behemoth", 大脚: "sasquatch", 狂猎: "wildHunt",
  兽态人: "skinwalker", 剪影人: "wayang", 勒珊塔灵: "kasatha", 卡萨达: "kasatha", 小灰人: "gray", 狼妖: "adlet", 猫人族: "catfolk",
  鼠人: "ratfolk", 鼠族: "ratfolk", 阿斯托莫伊人: "astomoi", 蜂巢: "hive", 圣仙: "manasaputra", 莫提克: "mortic", 白化人: "munavri",
  蝮血裔: "vishkanya", 狐妖: "kitsune", 轮回者: "samsaran", 灵猴族: "vanara", 树蛙人: "grippli" };
const SUB_LABEL = () => Object.fromEntries(Object.entries(pf1.config.creatureSubtypes).map(([k, v]) => [game.i18n.localize(v), k]));
function subtypeKeys(str) {
  const label = SUB_LABEL();
  const out = [];
  for (let s of (str || "").split(/[;；，,、]/).map((x) => x.trim()).filter(Boolean)) {
    if (/^增强/.test(s)) { out.push("augmented"); continue; } // 增强（类人生物）
    const b = s.replace(/(亚种|子类|种)$/, "");
    const k = SUB_KEY[s] || SUB_KEY[b] || label[s] || label[b];
    out.push(k || s); // 系统里没有的子类（豺狼人、沼蜍人）照属性块写成自定义
  }
  return [...new Set(out)];
}
function raceSpeeds(sp) {
  return { land: sp.land ?? 0, climb: sp.climb ?? null, swim: sp.swim ?? null, burrow: sp.burrow ?? null,
    fly: sp.fly?.base ?? null, flyManeuverability: sp.fly?.base ? sp.fly.maneuverability || "average" : "" };
}
let RACES = null;
async function raceList() {
  if (RACES) return RACES;
  const idx = await game.packs.get("pf1.races").getIndex({ fields: ["system.creatureTypes"] });
  RACES = [...idx].map((e) => ({ uuid: `Compendium.pf1.races.Item.${e._id}`, zh: e.name.replace(/\s*[（(].*$/, "").trim(),
    en: e.originalName || e.flags?.babele?.originalName || (/[（(](.+)[)）]\s*$/.exec(e.name) || [])[1] || "", types: e.system?.creatureTypes || [] }))
    .sort((a, b) => b.zh.length - a.zh.length);
  return RACES;
}
// 核心种族里有的（「男性人类战士」里的人类、属性块本身就是大地精）用合集包的种族，生物类型对不上（人类吸血鬼是不死生物）就不用；
// 否则这个怪物自己就是一个种族：名字、体型、速度、类型、子类都照属性块
async function raceItem(p, log) {
  const type = TYPE_KEY[p.type];
  const subs = subtypeKeys(p.subtypes);
  const races = await raceList();
  const text = p.classLine || p.classes.map((c) => c.name).join(" "); // 「人类 战士 4/盗贼 3」「男性半精灵平民 1」
  const core = races.find((r) => r.types.includes(type) && (r.en === p.en || r.zh === p.zh || (text && text.includes(r.zh))));
  let d;
  if (core) {
    d = await fromC(core.uuid);
    d.system.creatureSubtypes = [...new Set([...(d.system.creatureSubtypes || []), ...subs])];
    d.system.languages = []; // 语言照属性块（角色上已经写了）
    log.push(`种族：${d.name}`);
  } else {
    const icon = { humanoid: "humanoid.jpg", ooze: "ooze.jpg", magicalBeast: "magical-beast.png", monstrousHumanoid: "monstrous-humanoid.png" }[type] || `${type || "aberration"}.png`;
    d = { name: ownRaceName(p, races), type: "race", img: `systems/pf1/icons/races/creature-types/${icon}`,
      system: { creatureTypes: type ? [type] : [], creatureSubtypes: subs,
        description: { value: `<p>${p.zh}：${p.type}${p.subtypes ? `（${p.subtypes}）` : ""}。按属性块生成的种族，数值都在属性块里，种族本身不带修正。</p>` } } };
  }
  // 体型、速度以属性块为准（种族的体型和速度会盖过角色上的）
  d.system.size = p.size;
  d.system.speeds = raceSpeeds(p.speed || {});
  return d;
}

// 自带种族的名字：带职业的取职业前面的种族词（「巨魔战士 3」→ 巨魔）；龙去掉年龄（古红龙 → 红龙）；其余去掉体型（大型火元素 → 火元素）
function ownRaceName(p, races) {
  // 「人类巫妖」：种族词是核心种族、但生物类型已经变了（模板），种族就叫这个怪物（巫妖）
  if (p.raceHint && !races.some((r) => r.zh === p.raceHint)) return p.raceHint;
  let n = p.zh.replace(/[（(].*$/, "").replace(/^(动物伙伴|魔宠|坐骑|幻灵|伙伴)[：:]/, "").trim();
  if (p.type === "龙类") n = n.replace(/^(初生|幼生|幼年|幼|少年|年轻|青年|成年|壮年|年长|老年|暮年|远古|上古|太古|古|巨)(?=.+龙)/, "");
  n = n.replace(/^(微型|超小型|小型|中型|大型|超大型|巨型|超巨型|元素长老)(?=..)/, "");
  return n || p.zh;
}

// 能力值：种族调整、增强腰带之类会在属性块数值上再加一次，把基础值往回调到总值等于属性块
async function fixAbilities(actor, p, log) {
  const upd = {};
  for (const [k, v] of Object.entries(p.abilities)) {
    if (v == null) continue;
    const a = actor.system.abilities[k];
    const d = v - (a?.total ?? v);
    if (d) upd[`system.abilities.${k}.value`] = (actor._source.system.abilities[k]?.value ?? v) + d;
  }
  if (Object.keys(upd).length) {
    const msg = Object.entries(upd).map(([k, v]) => `${k.split(".")[2]} 基础 ${v}`).join("，");
    await actor.update(upd);
    log.push(`能力值按种族/物品调整：${msg}`);
  }
}

function baseActorData(p, folder) {
  const abilities = {};
  for (const [k, v] of Object.entries(p.abilities)) abilities[k] = { value: v };
  const sp = p.speed;
  const senses = { dv: { value: p.senses.dv || 0 }, ts: { value: p.senses.ts || 0 }, bs: { value: p.senses.bs || 0 },
    bse: { value: p.senses.bse || 0 }, sc: { value: p.senses.sc || 0 }, ll: { enabled: !!p.senses.ll },
    sid: !!p.senses.sid, si: !!p.senses.si, custom: p.senses.custom || "" };
  const lang = langKeys(p.languages);
  const tok = pf1.config.tokenSizes[p.size] || { w: 1, h: 1, scale: 1 };
  const extra = [
    p.organization && `<p><strong>组织</strong>：${p.organization}</p>`,
    p.environment && `<p><strong>环境</strong>：${p.environment}</p>`,
    p.treasure && `<p><strong>宝藏</strong>：${p.treasure}</p>`,
    p.source && `<p><strong>出处</strong>：${p.source}</p>`,
    p.ai && `<p><em>（属性块为 AI 从英文译出，未经人工校对。）</em></p>`,
  ].filter(Boolean).join("");
  return {
    name: `${p.zh} (${p.en})`, type: "npc", folder,
    system: {
      abilities,
      attributes: {
        ...(p.type === "不死生物" ? { hpAbility: "cha", savingThrows: { fort: { ability: "cha" } } } : {}),
        ...(p.type === "构装体" ? { hpAbility: "" } : {}),
        naturalAC: p.ac.natural || 0,
        speed: { land: { base: sp.land ?? 0 }, climb: { base: sp.climb ?? null }, swim: { base: sp.swim ?? null },
          burrow: { base: sp.burrow ?? null }, fly: { base: sp.fly?.base ?? null, maneuverability: sp.fly?.maneuverability || "average" } },
        sr: { formula: p.sr ? String(p.sr) : "" },
      },
      details: { alignment: p.alignment || "tn", cr: { base: crValue(p.cr) }, biography: { value: (p.bio || "") + extra } },
      traits: {
        size: p.size, senses,
        // PF1 的语言、免疫栏都允许在键之外直接写自定义文字
        languages: [...lang.keys, ...lang.custom],
        ...defenseTraits(p.defenses),
        regen: p.regen || "", fastHealing: p.fastHealing || "",
      },
    },
    prototypeToken: { name: p.zh, width: tok.w, height: tok.h, texture: { scaleX: tok.scale, scaleY: tok.scale } },
  };
}


const SAVE_ZH = { fort: "强韧", ref: "反射", will: "意志" };
const SHAPE_ZH = { cone: "锥形", circle: "半径", ray: "直线", rect: "方形" };
const EN_SAVE = [[/half/i, "通过则伤害减半"], [/negates/i, "通过则无效"], [/partial/i, "通过则部分生效"], [/disbelief/i, "通过则识破"]];

// 喷吐、凝视、灵光等：DC、豁免、模板/范围、伤害、持续时间按属性块写进动作；英文的豁免说明和注释换成中文
function applyParams(d, prm, rawLine) {
  prm = prm || {};
  let acts = d.system.actions;
  if (!acts?.length) {
    if (!prm.dc && !prm.damage) return;
    acts = d.system.actions = [{ _id: foundry.utils.randomID(16), name: "使用", actionType: prm.dc ? "save" : "other",
      activation: { type: "special", unchained: { type: "special" } } }];
  }
  const a = acts[0];
  if (prm.dc || a.save?.type) {
    const type = prm.saveType || a.save?.type || "";
    let desc = prm.saveDesc || "";
    if (!desc && a.save?.description) desc = (EN_SAVE.find(([re]) => re.test(a.save.description)) || [null, /[A-Za-z]/.test(a.save.description) ? "" : a.save.description])[1];
    a.save = { ...(a.save || {}), type, dc: prm.dc || a.save?.dc || "", description: type && desc ? `${SAVE_ZH[type]}，${desc}` : desc };
  }
  if (prm.template) {
    a.measureTemplate = { ...(a.measureTemplate || {}), type: prm.template.type, size: prm.template.size };
    a.area = `${prm.template.size} 尺${SHAPE_ZH[prm.template.type] || ""}`;
    if (a.range?.value && prm.template.type === "circle") a.range = { units: "ft", value: prm.template.size }; // 以自身为中心
  }
  if (prm.range) {
    if (a.measureTemplate?.type) { a.measureTemplate.size = prm.range; a.area = `${prm.range} 尺${SHAPE_ZH[a.measureTemplate.type] || ""}`; }
    else a.range = { units: "ft", value: prm.range };
  } else if (a.area && /[A-Za-z]/.test(a.area)) a.area = "";
  // 几段伤害（死亡阵痛：12d6 寒冷 + 8d6 穿刺）都写进去
  const dmgs = prm.damages?.length ? prm.damages : prm.damage ? [prm.damage] : [];
  if (dmgs.length) a.damage = { ...(a.damage || {}), parts: dmgs.map((x) => ({ formula: x.formula, types: (x.types || []).filter(Boolean) })) };
  if (prm.duration) a.duration = { ...(a.duration || {}), ...prm.duration };
  const keep = (a.notes?.effect || []).filter((n) => !/[A-Za-z]{4,}/.test(n.replace(/@\w+\[[^\]]*\](\{[^}]*\})?/g, "")))
    // 状态链接的显示文字换成中文状态名（{Paralyzed} → {麻痹}）
    .map((n) => n.replace(/\{([A-Za-z ]+)\}/g, (m0, w) => `{${pf1.registry.conditions.get(w.toLowerCase().replace(/ (\w)/g, (x, c) => c.toUpperCase()))?.name || w}}`));
  a.notes = { ...(a.notes || {}), effect: rawLine ? [...keep, rawLine] : keep };
}

// 名字比对用：去掉括注、类型、末尾等级数字（「武器训练 1」「偷袭 +3d6」「英勇（Ex）」）
const featKey = (n) => (n || "").replace(/\s*[（(].*$/, "").replace(/\s*[+＋]?\d+d?\d*$/, "").trim();
const CLASS_FEATS = new Map();
// 这只 NPC 的各职业（含进阶职业）按 classAssociations 会得到的职业特性：中文名、英文名 → uuid
async function ownClassFeatures(p) {
  const out = new Map();
  for (const c of p.classes || []) {
    if (!CLASS_FEATS.has(c.uuid)) {
      const m = new Map();
      const cls = await fromUuid(c.uuid).catch(() => null);
      for (const l of cls?.system?.links?.classAssociations || []) {
        const it = await fromUuid(l.uuid).catch(() => null);
        if (!it) continue;
        m.set(featKey(it.name), l.uuid);
        const en = (/\(([^()]+)\)\s*$/.exec(it.name) || [])[1];
        if (en) m.set(featKey(en), l.uuid);
      }
      CLASS_FEATS.set(c.uuid, m);
    }
    for (const [k, v] of CLASS_FEATS.get(c.uuid)) if (!out.has(k)) out.set(k, v);
  }
  return out;
}

async function itemsFor(p, log) {
  const items = [];
  if (p.racialHD?.uuid) {
    const d = await fromC(p.racialHD.uuid);
    d.system.level = p.racialHD.level;
    items.push(d);
  }
  for (const c of p.classes) {
    const d = await fromC(c.uuid);
    d.system.level = c.level;
    items.push(d);
  }
  for (const f of p.feats) {
    const d = await fromC(f.uuid);
    if (!d) { log.push(`专长没取到：${f.raw}`); continue; }
    if (f.param) d.name = `${d.name.replace(/\s*\(.*\)$/, "")}（${f.param}）`;
    // 技能专攻：合集包里的条目不带修正（要玩家自己选技能），按括注的技能加 +3，该技能 10 级起 +6
    if (f.skills?.length) {
      const paths = subPaths(p);
      for (const sk of f.skills) {
        // 「表演（戏剧，演讲）」是一项、「表演（吹奏乐器）」对技能专攻（表演〔吹奏〕）：按包含比
        const i = p.skills.findIndex((x) => x.key === sk.key && (!sk.sub || x.sub === sk.sub || (x.sub || "").includes(sk.sub)));
        const path = i >= 0 ? paths[i] : sk.sub ? null : sk.key;
        if (!path) { log.push(`技能专攻的技能不在技能栏里：${f.param}`); continue; }
        d.system.changes = [...(d.system.changes || []), { formula: `ifelse(gte(@skills.${path}.rank, 10), 6, 3)`,
          target: `skill.${path.replace(".subSkills.", ".")}`, type: "untyped", operator: "add", priority: 0 }];
      }
    }
    items.push(d);
  }
  for (const f of p.featsMissing) log.push(`专长没对上合集包：${f.raw}`);
  // 怪物能力：对上通用规则的复制原条目，描述换成属性块里的具体写法
  const own = await ownClassFeatures(p);
  for (const a of p.abilitiesItems) {
    // 职业能力重名的多（英勇、野性认同、偏好地形……各职业各一条）：先在这只 NPC 自己职业的特性里找同名的
    const mine = own.get(featKey(a.name));
    if (mine && mine !== a.uuid) { log.push(`职业能力按自己的职业：${a.name}`); a.uuid = mine; }
    let d = a.uuid ? await fromC(a.uuid) : null;
    if (d && d.type === "attack") d = null;
    if (!d) {
      d = { name: a.name, type: "feat", img: a.img || undefined, system: { subType: "misc", description: { value: a.text || "" } } };
    } else {
      if (a.text) d.system.description.value = a.text + `<hr />` + (d.system.description?.value || "");
      // 属性块里的叫法和通用规则词条名不同时（凶威 / 气势凶猛），名字用属性块的，括注英文
      const en = (d.name.match(/\(([^()]+)\)\s*$/) || [])[1];
      if (!d.name.startsWith(a.name)) d.name = en ? `${a.name} (${en})` : a.name;
    }
    applyParams(d, a.params, a.raw && a.raw !== a.name ? a.raw : "");
    if (a.type) d.name = `${d.name.replace(/\s*\(.*\)$/, "")}（${a.type}）`.replace(/（（/g, "（");
    d.system.abilityType = ({ Ex: "ex", Su: "su", Sp: "sp" })[a.type] || d.system.abilityType || "none";
    // 分栏：职业来的（职业能力、进阶职业、变体）和神话能力放职业能力；专长照旧；其余都是这个种族的种族特性
    if (d.type === "feat") {
      const src = (a.uuid || "").split(".").slice(1, 3).join(".");
      const classy = ["pf1.class-abilities", "pf-content.pf-class-abilities", "pf1e-archetypes.pf-prestige-features", "pf1e-archetypes.pf-arch-features"].includes(src);
      if (classy || /神话|Mythic/i.test(d.name) || (src === "pf1-zh-monsters.supplement" && d.system.subType === "classFeat")) d.system.subType = "classFeat";
      else if (!["pf1.feats", "pf-content.pf-feats"].includes(src)) d.system.subType = "racial";
    }
    items.push(d);
  }
  return items;
}

async function natTemplate(natural) {
  const pack = game.packs.get("pf1.monster-abilities");
  const idx = await pack.getIndex();
  const e = [...idx].find((x) => (x.originalName || x.flags?.babele?.originalName || x.name).replace(/^.*\(|\)$/g, "") === natural
    || x.name === natural || x.name.endsWith(`(${natural})`));
  return e ? fromC(`Compendium.pf1.monster-abilities.Item.${e._id}`) : null;
}

async function attackItems(p, log) {
  const out = [];
  const natMaxOf = (set) => Math.max(...p.attacks.filter((a) => a.natural && a.set === set).map((a) => a.bonus[0]), -99);
  const hasWeaponOf = (set) => p.attacks.some((a) => !a.natural && a.set === set && a.kind === "melee");
  const built = new Set();
  for (const a of p.attacks) {
    const natMax = natMaxOf(a.set), hasWeapon = hasWeaponOf(a.set);
    // 「或」之后的另一套：同名兵器已经建过就不重复；天生攻击单独建一条，名字标明
    if (a.set > 0 && !a.natural && built.has(a.name)) continue;
    let d = null;
    if (a.supp) d = await fromC(a.supp); // 补充合集包里的攻击（尾扫、投石、接触……）
    else if (a.natural) d = await natTemplate(a.natural);
    if (!d) {
      // 兵器：去装备合集包里找同名武器
      let w = await findGear(a.name);
      // 对上的是不能攻击的物品（铁链、炼金物品）：自建攻击
      if (w && !(["weapon", "attack"].includes(w.type) && (w.system.actions || []).some((x) => /wak|msak|rsak|twak/.test(x.actionType || "")))) w = null;
      d = w || { name: a.name, type: "attack", system: { subType: a.natural ? "natural" : "weapon", actions: [{ name: "攻击", actionType: a.kind === "ranged" ? "rwak" : "mwak", activation: { type: "attack" }, range: { units: a.kind === "ranged" ? "ft" : "melee" }, ability: { attack: a.kind === "ranged" ? "dex" : "str", damage: a.kind === "ranged" ? null : "str", damageMult: 1 }, damage: { parts: [{ formula: a.dice || "1", types: [] }] } }] } };
      if (!w) log.push(`攻击没对上合集包，自建：${a.name}`);
    }
    d.name = a.set > 0 ? `${a.name}（另一套全攻击）` : a.name;
    built.add(a.name);
    if (d.type === "weapon") d.system.equipped = true;
    const act = d.system.actions?.[0];
    if (act) {
      act.ability = { ...(act.ability || {}), critRange: a.critRange, critMult: a.critMult };
      if (a.dice) act.damage = { ...(act.damage || {}), parts: [{ formula: a.dice, types: act.damage?.parts?.[0]?.types || [] }] };
      if (a.natural && (hasWeapon || a.bonus[0] <= natMax - 3)) {
        act.naturalAttack = { primary: false, secondary: { attackBonus: "-5", damageMult: 0.5 } };
      }
      const extras = [];
      for (let i = 1; i < a.count; i++) extras.push({ name: `${a.name} #${i + 1}`, formula: "0" });
      if (extras.length) act.extraAttacks = { type: "custom", manual: extras };
      if (a.extra) act.notes = { ...(act.notes || {}), footer: [a.extra] };
    }
    d.flags = { ...(d.flags || {}), "zh-monsters": { target: a } };
    out.push(d);
  }
  return out;
}

let GEAR_IDX = null;
async function findGear(zh) {
  if (!GEAR_IDX) GEAR_IDX = (await fetch("/zh-monsters/gear_index.json").then((r) => r.ok ? r.json() : {}).catch(() => ({})));
  // 材质前缀（寒铁匕首、银质短剑、秘银胸甲）：找基础物品，名字照属性块
  let base = zh.replace(/\[.*?\]/g, "").trim().replace(/^(精制品|精致|精制|精工|破损|无匹)/, "")
    .replace(/^(寒铁|冷铁|炼金银|炼银|银质|秘银|精金|暗木|龙骨|水晶|骨质|骨制|石质|黑曜石|铁木|银)(?=..)/, "");
  const plus = base.match(/^(.*?)\s*\+(\d)$/);
  const tries = [zh, base];
  if (plus) tries.push(`+${plus[2]}${plus[1]}`, `+${plus[2]}${plus[1].replace(/^无匹/, "")}`);
  tries.push({ "箭": "箭矢", "弩矢": "弩矢" }[base] || base);
  for (const t of [...tries]) tries.push(t.replace(/\s+/g, ""), t.replace(/\s*([+-]\d)/, " $1"));
  // 魔法武器「+1 斩首邪恶长剑」：取增强加值，再从名字尾部找合集包里最长的武器名当基础武器
  const enh = zh.match(/^\+(\d)\s*/);
  let core = zh.replace(/^\+\d\s*/, "").replace(/[（(].*$/, "").replace(/^(精制品|精致|精制|精工)/, "").trim();
  if (enh || core !== zh) for (let i = 0; i < core.length - 1; i++) tries.push(core.slice(i));
  for (const t of tries) {
    if (!GEAR_IDX[t]) continue;
    const d = await fromC(GEAR_IDX[t]);
    if (!d) return null;
    if (/^(精制品|精致|精制|精工)/.test(zh) || enh) d.system.masterwork = true;
    if (/^破损/.test(zh)) d.system.broken = true;
    if (enh) { d.system.enh = Number(enh[1]); d.name = zh.replace(/[（(].*$/, "").trim(); }
    else if (t !== zh && /^(寒铁|冷铁|炼金银|炼银|银质|秘银|精金|暗木|龙骨|水晶|骨质|骨制|石质|黑曜石|铁木|银)/.test(zh)) d.name = zh.replace(/[（(].*$/, "").trim();
    return d;
  }
  return null;
}

async function spellItems(p, actor, log) {
  const items = [];
  const bookUpdates = {};
  const add = async (book, bookKey, isSLA) => {
    if (!book) return;
    for (const g of book.groups) {
      for (const s of g.spells) {
        if (!s.uuid && s.featUuid) {
          // 写在法术栏里的领域能力、学派能力（秩序之触、魅惑微笑）：作为职业能力放进特殊能力
          const f = await fromC(s.featUuid);
          if (f) { items.push(f); continue; }
        }
        if (!s.uuid) { log.push(`法术没对上：${s.raw}`); continue; }
        const d = await fromC(s.uuid);
        if (!d) continue;
        d.system.spellbook = bookKey;
        if (!isSLA && g.level != null) d.system.level = g.level;
        if (s.meta) d.name = `${s.meta}${d.name}`;
        if (s.summon) {
          // 魔类的召唤：用对应环级的召唤怪物法术，名字和描述写明只能召唤什么、成功率多少，附上通用规则「召唤」
          d.name = `召唤（等级 ${s.summon.level}，${s.summon.detail}）`;
          const rule = s.summon.uuid ? await fromUuid(s.summon.uuid) : null;
          d.system.description.value = `<p><strong>召唤</strong>：等级 ${s.summon.level}，${s.summon.detail}。</p>`
            + (rule ? `<hr />${rule.system.description.value}` : "") + `<hr />` + (d.system.description?.value || "");
        }
        if (s.note) d.name = `${d.name}（${s.note}）`;
        const per = isSLA ? (g.atWill || g.constant ? 0 : (g.perDay || 1)) : s.count;
        if (isSLA && (g.atWill || g.constant)) d.system.atWill = true;
        if (isSLA && g.constant) d.name = `${d.name}（恒定）`;
        // 照系统自带怪物的写法：每日次数记在「已准备」上，随意/恒定的标成随意施展
        d.system.preparation = { ...(d.system.preparation || {}), value: per || 1, max: per || 1 };
        const lvl = d.system.level ?? 0;
        slots[bookKey][lvl] = (slots[bookKey][lvl] || 0) + (isSLA && !per ? 0 : (isSLA ? per : s.count));
        if (!isSLA && g.perDay) spont[lvl] = g.perDay;
        d.flags = { ...(d.flags || {}), "zh-monsters": { dc: s.dc } };
        items.push(d);
      }
    }
  };
  const slots = { spelllike: {}, primary: {} }, spont = {};
  // 关掉自动法术位计算，每环次数按属性块手填：不再出现「属性值不足」「已知 +N」「+1 学派」之类提示
  const manual = (key, counts) => {
    const spells = {};
    for (let l = 0; l <= 9; l++) spells[`spell${l}`] = { base: counts[l] || 0 };
    return { autoSpellLevelCalculation: false, autoSpellLevels: false, domainSlotValue: 0, noAbilityLimit: true, spells };
  };
  if (p.sla) {
    await add(p.sla, "spelllike", true);
    bookUpdates["system.attributes.spells.spellbooks.spelllike"] = { inUse: true, name: "类法术能力", class: "_hd", ability: "cha",
      spellPreparationMode: "prepared", casterType: "high", hasCantrips: true, arcaneSpellFailure: false,
      // 属性块没写施法者等级的（或写漏了数字）：按生命骰（类法术能力的通常规则）
      cl: { formula: p.sla.cl == null ? "0" : String(p.sla.cl - (p.racialHD?.level || 0) - p.classes.reduce((s, c) => s + c.level, 0)) },
      ...manual("spelllike", slots.spelllike) };
  }
  if (p.spells) {
    await add(p.spells, "primary", false);
    // 法术书挂在会施法的职业上（嗜杀镰客 战士6/刺客7/德鲁伊4 → 德鲁伊），标题里点名的优先（「已准备德鲁伊法术」）
    const casters = actor.items.filter((i) => i.type === "class" && i.system.subType !== "racial" && i.system.casting?.type);
    const named = casters.find((c) => (p.spells.title || "").includes(c.name.replace(/[（(].*$/, "").trim()));
    const cls = named || casters.sort((x, y) => (y.system.level || 0) - (x.system.level || 0))[0]
      || actor.items.find((i) => i.type === "class" && i.system.subType !== "racial");
    const prepared = p.spells.prepared;
    const counts = prepared ? slots.primary : { ...slots.primary, ...spont };
    bookUpdates["system.attributes.spells.spellbooks.primary"] = { inUse: true, name: p.spells.title || "法术",
      class: cls ? cls.system.tag : "_hd", spellPreparationMode: prepared ? "prepared" : "spontaneous",
      // 施法属性按职业（德鲁伊、牧师是感知；原来已准备的一律写成智力）
      ability: cls?.system?.casting?.ability || (prepared ? "int" : "cha"), casterType: "high", ...manual("primary", counts) };
    if (!cls) bookUpdates["system.attributes.spells.spellbooks.primary"].cl = { formula: p.spells.cl == null ? "0" : String(p.spells.cl - (p.racialHD?.level || 0)) };
  }
  return { items, bookUpdates };
}

function rollBonus(roll) {
  const dice = roll.dice.reduce((s, d) => s + d.total, 0);
  return roll.total - dice;
}

async function adjust(actor, p, log) {
  const changes = [];
  const push = (target, value, label) => {
    if (!value) return;
    changes.push({ formula: String(value), target, type: "untyped", operator: "add", priority: 0 });
    log.push(`补差 ${label}：${value > 0 ? "+" : ""}${value}`);
  };
  const A = actor.system.attributes;
  // HP：调种族生命骰/职业的 hp
  const hpNow = A.hp.max;
  if (p.hp.total && hpNow !== p.hp.total) {
    // 每个职业的 hp 至少 1：第一个职业减不够的（平民 1 + 专家 1 共 10 HP）接着减下一个
    let left = p.hp.total - hpNow;
    for (const cls of actor.items.filter((i) => i.type === "class")) {
      if (!left) break;
      const cur = cls.system.hp || 0;
      const next = Math.max(1, cur + left);
      if (next === cur) continue;
      await cls.update({ "system.hp": next });
      left -= next - cur;
    }
    log.push(`HP 由 ${hpNow} 调到 ${actor.system.attributes.hp.max}${left ? `（还差 ${left}）` : ""}`);
  }
  // 种族生命骰的强弱豁免：先试着改进度，改得对就不用补差
  const rhd = actor.items.find((i) => i.type === "class" && i.system.subType === "racial");
  if (rhd) {
    const lvl = rhd.system.level || 0;
    const good = 2 + Math.floor(lvl / 2), poor = Math.floor(lvl / 3);
    const upd = {};
    for (const k of ["fort", "ref", "will"]) {
      const d = (p.saves[k] ?? 0) - actor.system.attributes.savingThrows[k].total;
      const cur = rhd.system.savingThrows?.[k]?.value;
      if (d === good - poor && cur !== "high") upd[`system.savingThrows.${k}.value`] = "high";
      if (d === poor - good && cur !== "low") upd[`system.savingThrows.${k}.value`] = "low";
    }
    if (Object.keys(upd).length) {
      await rhd.update(upd);
      log.push(`种族生命骰豁免进度：${JSON.stringify(upd)}`);
    }
  }
  return null;
}

// 迭代补差：各项修正互相牵连（BAB 影响 CMB/CMD，护甲影响措手不及），每轮重读系统数值、只补剩下的差，直到全部吻合
async function iterateAdjust(actor, p, log, skillChanges) {
  const LABEL = { bab: "BAB", fort: "强韧", ref: "反射", will: "意志", init: "先攻", cmb: "CMB", cmd: "CMD",
    tac: "接触AC", nac: "普通AC（天生）", ffac: "措手不及AC" };
  const sum = {};
  const diff = (target, now) => (target == null || now == null ? 0 : target - now);
  const build = () => ({ name: ADJ_NAME, type: "feat", img: "systems/pf1/icons/skills/yellow_36.jpg",
    system: { subType: "misc", description: { value: "<p>让 PF1 自动计算的数值与《怪物图鉴》属性块一致而加的修正。删掉它就能看到系统原始的计算结果。</p>" },
      changes: [...skillChanges, ...Object.entries(sum).filter(([, v]) => v).map(([target, v]) => ({ formula: String(v), target, type: "untyped", operator: "add", priority: 0 }))] } });
  let item = null;
  const commit = async () => {
    const data = build();
    if (!data.system.changes.length) return;
    if (!item) [item] = await actor.createEmbeddedDocuments("Item", [data]);
    else await item.update({ "system.changes": data.system.changes });
  };
  await commit();
  for (let round = 0; round < 5; round++) {
    const B = actor.system.attributes;
    const d = {};
    // BAB 先单独补一轮
    d.bab = diff(p.bab, B.bab.total);
    if (!d.bab || round > 0) {
      if (round > 0 && d.bab) { /* BAB 已补过仍不对：不再动 */ d.bab = 0; }
      d.fort = diff(p.saves.fort, B.savingThrows.fort.total);
      d.ref = diff(p.saves.ref, B.savingThrows.ref.total);
      d.will = diff(p.saves.will, B.savingThrows.will.total);
      d.init = diff(p.init, B.init.total);
      d.cmb = diff(p.cmb, B.cmb.total);
      d.cmd = diff(p.cmd, B.cmd.total);
      d.tac = diff(p.ac.touch, B.ac.touch.total);
      d.nac = diff(p.ac.normal, B.ac.normal.total); // 普通与措手不及一起动
      if (!d.nac) d.ffac = diff(p.ac.ff, B.ac.flatFooted.total); // 普通已对，再单独补措手不及
    }
    const any = Object.values(d).some((v) => v);
    if (!any) break;
    for (const [k, v] of Object.entries(d)) if (v) sum[k] = (sum[k] || 0) + v;
    await commit();
  }
  for (const [k, v] of Object.entries(sum)) if (v) log.push(`补差 ${LABEL[k] || k}：${v > 0 ? "+" : ""}${v}`);
}

// 标识符：PF1 没有标识符时按物品名生成，中文名里的汉字会被丢掉，只剩「ex」「su」，同一只怪的能力就撞成同一个标识符
// （带次数的能力会报「发现重复的物品标识符」，资源公式也会指错）。按英文名生成，没有英文名用中文名的散列，同名的加编号
async function assignTags(base) {
  const used = new Set();
  const todo = [];
  for (const d of base) {
    const t = d.system?.tag;
    if (!t) continue;
    // 同一只怪里两条同标识符的（两个技能专攻、两种吐息）：后一条加编号
    if (t.length >= 3 && !used.has(t.toLowerCase())) used.add(t.toLowerCase());
    else if (["feat", "attack"].includes(d.type)) todo.push(d);
  }
  for (const d of base) {
    if (!["feat", "attack"].includes(d.type)) continue; // PF1 只对能力和攻击用标识符（资源、公式引用）
    if (d.system?.tag && !todo.includes(d)) continue;
    if (d.system?.tag && d.system.tag.length >= 3) {
      let u = d.system.tag;
      for (let k = 2; used.has(u.toLowerCase()); k++) u = d.system.tag + k;
      used.add(u.toLowerCase());
      d.system.tag = u;
      continue;
    }
    let en = d.flags?.babele?.originalName || /\(([A-Za-z][^()]*)\)\s*$/.exec(d.name)?.[1];
    const src = d._stats?.compendiumSource;
    if (!en && src) {
      const o = await fromUuid(src).catch(() => null);
      en = o?.flags?.babele?.originalName || /\(([A-Za-z][^()]*)\)\s*$/.exec(o?.name || "")?.[1];
    }
    let t = en ? pf1.utils.createTag(en.replace(/\s*\[[^\]]*\]/g, "")) : "";
    if (!t || t.length < 3) {
      let h = 0;
      for (const ch of d.name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      t = (t || "zh") + h.toString(36);
    }
    let u = t;
    for (let k = 2; used.has(u.toLowerCase()); k++) u = t + k;
    used.add(u.toLowerCase());
    foundry.utils.setProperty(d, "system.tag", u);
  }
}

// 职业物品会自动带上职业特性；我们自己按属性块建的条目都标了 flags.zh-monsters.mine；属性块里也写了的，留属性块那条（有属性块的数值和说明），删自动带的
async function dedupeClassFeatures(actor, log) {
  const bySrc = {};
  for (const i of actor.items) {
    if (i.type === "class") continue;
    const src = i._stats?.compendiumSource;
    if (src) (bySrc[src] = bySrc[src] || []).push(i);
    // 来源不同但标识符相同（PF1 会报重复标识符）的也算重复
    const tag = i.system?.tag?.toLowerCase();
    if (tag && i.type === "feat") (bySrc["tag:" + tag] = bySrc["tag:" + tag] || []).push(i);
  }
  const del = [];
  for (const list of Object.values(bySrc)) {
    if (list.length < 2) continue;
    const mine = list.filter((i) => i.flags?.["zh-monsters"]?.mine);
    if (!mine.length) continue;
    del.push(...list.filter((i) => !i.flags?.["zh-monsters"]?.mine && !del.includes(i.id)).map((i) => i.id));
  }
  if (del.length) {
    await actor.deleteEmbeddedDocuments("Item", del);
    log.push(`职业自动带的重复特性删掉 ${del.length} 条`);
  }
  return del.length;
}

// 子技能（表演、手艺、专业可以有好几项）：按出现顺序编号 prf1、prf2……
function subPaths(p) {
  const n = {};
  return p.skills.map((s) => (s.sub ? `${s.key}.subSkills.${s.key}${(n[s.key] = (n[s.key] || 0) + 1)}` : s.key));
}

async function skillRanks(actor, p, log) {
  const upd = {};
  const paths = subPaths(p);
  p.skills.forEach((s, i) => {
    if (s.sub) {
      upd[`system.skills.${paths[i]}`] = { name: s.sub, ability: s.key === "crf" ? "int" : s.key === "prf" ? "cha" : "wis",
        rank: 0, rt: s.key !== "prf", acp: false };
    }
  });
  if (Object.keys(upd).length) await actor.update(upd);
  const pathOf = (s) => paths[p.skills.indexOf(s)];
  const hd = actor.system.attributes.hd.total;
  // 第一轮：按「无等级时的数值」推等级；本职技能有等级时额外 +3，要先扣掉
  const upd2 = {};
  for (const s of p.skills) {
    const sk = foundry.utils.getProperty(actor.system.skills, pathOf(s));
    if (!sk) { log.push(`技能没找到：${s.key}`); continue; }
    let need = s.total - sk.mod;
    if (need <= 0) continue;
    if (sk.cs && need > 3) need -= 3;
    upd2[`system.skills.${pathOf(s)}.rank`] = Math.max(1, Math.min(hd, need));
  }
  if (Object.keys(upd2).length) await actor.update(upd2);
  // 再调一轮：技能专攻到 10 级从 +3 变 +6，按第一轮推的等级会多出 3
  const upd3 = {};
  for (const s of p.skills) {
    const sk = foundry.utils.getProperty(actor.system.skills, pathOf(s));
    if (!sk || !sk.rank) continue;
    const d = s.total - sk.mod;
    const r = Math.max(1, Math.min(hd, sk.rank + d));
    if (d && r !== sk.rank) upd3[`system.skills.${pathOf(s)}.rank`] = r;
  }
  if (Object.keys(upd3).length) await actor.update(upd3);
  // 第二轮：剩下的差值记成修正
  const extra = [];
  for (const s of p.skills) {
    const sk = foundry.utils.getProperty(actor.system.skills, pathOf(s));
    if (!sk) continue;
    const d = s.total - sk.mod;
    if (d) extra.push({ formula: String(d), target: `skill.${pathOf(s).replace(".subSkills.", ".")}`, type: "untyped", operator: "add", priority: 0 });
  }
  return extra;
}

// dry：只核对不改，返回对不上的攻击（发布前的全量核对用）
export async function attackAdjust(actor, log, { dry = false } = {}) {
  const bad = [];
  for (const it of actor.items.filter((i) => i.flags?.["zh-monsters"]?.target)) {
    const t = it.flags["zh-monsters"].target;
    const act = it.defaultAction;
    if (!act) continue;
    try {
      const r = await act.rollAttack({});
      let now = rollBonus(r);
      const dmg = act.hasDamage ? await act.rollDamage({}) : null; // 捕网之类没有伤害，rollDamage 会报错
      const roll = Array.isArray(dmg) ? dmg[0] : dmg;
      let dnow = roll ? rollBonus(roll) : 0;
      // rollAttack/rollDamage 不算次要天然攻击；正式使用时系统会再扣 -5、力量减半，这里先算进去
      if (act.naturalAttack?.primary === false) {
        now += Number(act.naturalAttack.secondary?.attackBonus ?? -5);
        const abl = act.ability?.damage;
        const mod = abl ? actor.system.abilities[abl]?.mod ?? 0 : 0;
        const mult = act.ability?.damageMult ?? 1;
        const sec = act.naturalAttack.secondary?.damageMult ?? 0.5;
        if (mod > 0) dnow += Math.floor(mod * sec) - Math.floor(mod * mult);
      }
      if (it.system.broken) now -= 2; // 破损武器的 -2 同样只在正式使用时扣
      const d = t.bonus[0] - now;
      const dd = t.dmgBonus - dnow;
      const actions = foundry.utils.deepClone(it.system.actions);
      if (d) { // 差值是相对现有总值的，要加在原来的补差上（新建的攻击原来是 0）
        const old = String(actions[0].attackBonus ?? "").trim();
        const n = /^[+-]?\d+$/.test(old) ? Number(old) + d : old ? null : d;
        actions[0].attackBonus = n === null ? `${old} + ${d}` : n ? String(n) : "";
      }
      if (dd && actions[0].damage?.parts?.[0]) actions[0].damage.parts[0].formula += ` + ${dd}`;
      if ((d || dd) && dry) { bad.push(`${it.name} 攻击${d ? (d > 0 ? "少" : "多") + Math.abs(d) : ""}${dd ? " 伤害差" + dd : ""}`); continue; }
      if (d || dd) {
        await it.update({ "system.actions": actions });
        log.push(`攻击 ${it.name}：加值补 ${d}，伤害补 ${dd}`);
      }
    } catch (e) {
      log.push(`攻击 ${it.name} 计算失败：${e.message}`);
      bad.push(`${it.name} 计算失败`);
    }
  }
  return bad;
}


// 远程武器配弹药：属性块很少写箭矢数量，没有弹药系统就不让打，所以按弹药类型补一份基础弹药
const AMMO = { arrow: "23HXFjpPnuLFOylm", bolt: "v04yeRzoqrhYx0G7", repeatingBolt: "mEOR0Hj86mCU1hwm", slingBullet: "UWVXKSouid1jDJSm" };
async function ammoItems(items, log) {
  const out = [];
  const have = new Set(items.filter((i) => i.system?.subType === "ammo").map((i) => i.system.extraType));
  for (const w of items.filter((i) => i.type === "weapon")) {
    // 弹药类型可能写在物品上，也可能写在动作上（动作优先）
    const t = w.system.actions?.find((x) => x.ammo?.type)?.ammo.type || w.system.ammo?.type;
    if (!t || have.has(t)) continue;
    if (!AMMO[t]) { // 飞镖之类投掷武器：用自身数量
      if (w.system.ammo) w.system.ammo.type = "";
      for (const x of w.system.actions || []) if (x.ammo) x.ammo.type = "";
      continue;
    }
    const src = await fromUuid(`Compendium.pf1.weapons-and-ammo.Item.${AMMO[t]}`);
    const d = src.toObject();
    d.name = t === "slingBullet" ? "投石索弹丸" : d.name.replace(/\s*[（(].*$/, "").trim() || d.name;
    d.system.quantity = 20;
    d._stats = { ...(d._stats || {}), compendiumSource: src.uuid };
    have.add(t);
    out.push(d);
    log.push(`补弹药：${d.name} ×20（${w.name}）`);
  }
  return out;
}

// 攻击行和装备行里同一件武器的写法不一样（「精致短剑」↔「精制品短剑」、「+1 长剑」↔「+1长剑」）：比对时统一
const gearKey = (n) => (n || "").replace(/\s+/g, "").replace(/^(\+\d)?(精致品|精制品|精工品|精致|精制|精工|精良)/, "$1精制品");

async function gearItems(p, have, log) {
  const out = [];
  for (const g of p.gearList || []) {
    if (g.currency) continue; // 钱在 buildOne 里记到角色的货币上
    if (g.consumable) {
      // 药水/卷轴/魔杖：补充合集包里由法术生成的那一条
      const d = await fromC(g.uuid);
      if (!d) { log.push(`补充条目缺（先跑 syncSupplement）：${g.raw}`); continue; }
      d.system.quantity = g.qty || 1;
      if (g.charges && d.system.uses) d.system.uses.value = g.charges;
      out.push(d);
      continue;
    }
    if (have.has(g.zh) || have.has(g.zh.replace(/\s+/g, "")) || have.has(gearKey(g.zh))) continue;
    const d = await findGear(g.zh);
    if (!d) { log.push(`装备没对上：${g.raw}`); continue; }
    have.add(g.zh);
    if (["equipment", "weapon"].includes(d.type)) d.system.equipped = true;
    if (g.qty > 1) d.system.quantity = g.qty;
    out.push(d);
  }
  return out;
}

// ---- 附魔说明 ----
// 属性块里的魔法武器/护甲名字带着特殊能力（「+1 炽焰神圣弯刀」「+1破敌人类弩矢」「+1 中度护命胸甲」）：
// 从 pf-content 的「特殊品质」包找到这些能力，把规则说明附在物品说明后面，玩家点开就能看到
const ENCH_PACK = "pf-content.pf-special-qualities";
const ENCH_FOLDERS = {
  weapon: ["Weapons", "Melee Weapons", "Ranged Weapons"],
  armor: ["Armor", "Armor & Shields"],
  shield: ["Shields", "Armor & Shields"],
};
// 属性块（旧译、论坛译名）的叫法 → 英文名
const ENCH_ALIAS = {
  锋锐: "Keen", 锋利: "Keen", 闪电: "Shock", 火焰: "Flaming", 烈焰: "Flaming", 寒冰: "Frost", 霜寒: "Frost", 冰霜: "Frost",
  速度: "Speed", 炎爆: "Flaming Burst", 火爆: "Flaming Burst", 闪电爆发: "Shocking Burst", 雷霆: "Thundering", 创伤: "Wounding",
  舞动: "Dancing", 防御: "Defending", 护身: "Defending", 解法: "Dispelling", 回返: "Returning", 秩序: "Axiomatic", 混乱: "Anarchic",
  光滑: "Slick", 克敌: "Bane", 克星: "Bane", 恶毒: "Ominous", 冰冻: "Frost", 亵渎: "Unholy",
};
let ENCH = null;
async function enchIndex() {
  if (ENCH) return ENCH;
  const pack = game.packs.get(ENCH_PACK);
  const idx = await pack.getIndex({ fields: ["folder"] });
  const folderName = Object.fromEntries(pack.folders.map((f) => [f.id, f.flags?.babele?.originalName || f._source?.name || f.name]));
  ENCH = { byZh: new Map(), byEn: new Map() };
  for (const e of idx) {
    // 「中度护命 (Fortification (moderate))」：英文名里还有括号，按第一个「 (」切
    const cut = e.name.indexOf(" (");
    const en = e.originalName || e.flags?.babele?.originalName || (cut >= 0 ? e.name.slice(cut + 2, -1) : e.name);
    const zh = (cut >= 0 ? e.name.slice(0, cut) : e.name).replace(/（[^（）]*）$/, "").trim();
    const rec = { uuid: `Compendium.${ENCH_PACK}.Item.${e._id}`, en, zh, folder: folderName[e.folder] || "" };
    if (!ENCH.byEn.has(en)) ENCH.byEn.set(en, []);
    ENCH.byEn.get(en).push(rec);
    if (zh && /[一-鿿]/.test(zh)) {
      if (!ENCH.byZh.has(zh)) ENCH.byZh.set(zh, []);
      ENCH.byZh.get(zh).push(rec);
    }
  }
  return ENCH;
}
const ENCH_TYPES = "人类|精灵|矮人|侏儒|半身人|兽人|地精|巨人|龙类|龙|不死生物|不死|构装体|异怪|动物|魔法兽|人形怪物|类人生物|精类|植物|泥形生物|虫类|异界生物|邪恶异界生物|善良异界生物|守序异界生物|混乱异界生物|恶魔|魔鬼";
// 名字里的特殊能力 → [{rec, target}]；kind 是 weapon / armor / shield
export async function enchantsOf(name, kind) {
  const m = /^\s*[+＋]\s*\d\s*(.*)$/.exec(name || "");
  if (!m) return [];
  const I = await enchIndex();
  const okFolder = new Set(ENCH_FOLDERS[kind] || []);
  const pick = (list) => (list || []).find((r) => okFolder.has(r.folder));
  const zhKeys = [...new Set([...I.byZh.keys(), ...Object.keys(ENCH_ALIAS)])].filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
  let s = m[1].replace(/[（(][^（）()]*[）)]/g, "");
  const out = [];
  const add = (rec, target) => { if (rec && !out.some((o) => o.rec.uuid === rec.uuid)) out.push({ rec, target }); };
  // 破敌带对象：「破敌人类」「人类破敌」「邪恶异界生物克敌」「不死克星」
  const bane = pick(I.byEn.get("Bane"));
  s = s.replace(new RegExp(`(?:破敌|克敌|克星)(${ENCH_TYPES})|(${ENCH_TYPES})(?:破敌|克敌|克星)`, "g"), (all, a, b) => { add(bane, a || b); return " "; });
  for (let i = 0; i < s.length; ) {
    const k = zhKeys.find((z) => s.startsWith(z, i));
    if (!k) { i++; continue; }
    // 别名指向英文名；护甲版多半叫「X (Armor)」
    const rec = ENCH_ALIAS[k] ? pick([...(I.byEn.get(ENCH_ALIAS[k]) || []), ...(I.byEn.get(`${ENCH_ALIAS[k]} (Armor)`) || [])]) : pick(I.byZh.get(k));
    if (rec) add(rec, null);
    i += k.length;
  }
  return out;
}
export async function enchantHtml(name, kind) {
  const list = await enchantsOf(name, kind);
  if (!list.length) return "";
  const parts = [];
  for (const { rec, target } of list) {
    const doc = await fromUuid(rec.uuid).catch(() => null);
    if (!doc) continue;
    const title = doc.name.includes(" (") ? doc.name.slice(0, doc.name.indexOf(" (")) : doc.name;
    parts.push(`<h3>${title}${target ? `（${target}）` : ""}</h3>${doc.system.description?.value || ""}`);
  }
  return parts.length ? `<hr /><h2>附魔</h2>${parts.join("")}` : "";
}
// 物品名里的旧叫法换成维基/合集包的标准名（「+1锋锐细剑」→「+1锐锋细剑」「破敌克星」……）
export async function normalizeEnchantName(name) {
  if (!/^\s*[+＋]\s*\d/.test(name || "")) return name;
  const I = await enchIndex();
  let out = name;
  for (const [old, en] of Object.entries(ENCH_ALIAS).sort((a, b) => b[0].length - a[0].length)) {
    if (!out.includes(old)) continue;
    const std = (I.byEn.get(en) || [])[0]?.zh;
    if (std && std !== old) out = out.split(old).join(std);
  }
  return out;
}
const ENCH_MARK = "<h2>附魔</h2>";
// 物品说明后面附上附魔（已有的先去掉，重复执行不会叠）
export function enchKind(d) {
  return ["weapon", "attack"].includes(d.type) ? "weapon" : d.type === "equipment" && d.system?.subType === "shield" ? "shield"
    : d.type === "equipment" && d.system?.subType === "armor" ? "armor" : d.type === "loot" && d.system?.subType === "ammo" ? "weapon" : null;
}
export async function withEnchants(d) {
  const kind = enchKind(d);
  if (!kind) return null;
  const html = await enchantHtml(d.name, kind);
  const cur = d.system?.description?.value || "";
  const k = cur.indexOf(ENCH_MARK);
  const base = k >= 0 ? cur.slice(0, Math.max(0, cur.lastIndexOf("<hr />", k))) : cur;
  const next = base + html;
  return next === cur ? null : next;
}

// ---- 附魔的规则效果 ----
// 能量伤害（炽焰 1d6 火焰……）放「不倍增加值」（nonCritParts），重击不乘；爆发类另加「重击加值」（critParts，系统按倍数-1 自动放大，所以都写 1d10）；
// 神圣/邪恶/公理/混沌、破敌只对特定敌人生效：做成攻击对话框里的条件加值（默认不勾）
const ENCH_MECH = {
  Flaming: { nonCrit: [["1d6", "fire"]] },
  Frost: { nonCrit: [["1d6", "cold"]] },
  Shock: { nonCrit: [["1d6", "electric"]] },
  Corrosive: { nonCrit: [["1d6", "acid"]] },
  "Flaming Burst": { nonCrit: [["1d6", "fire"]], crit: [["1d10", "fire"]] },
  "Icy Burst": { nonCrit: [["1d6", "cold"]], crit: [["1d10", "cold"]] },
  "Shocking Burst": { nonCrit: [["1d6", "electric"]], crit: [["1d10", "electric"]] },
  "Corrosive Burst": { nonCrit: [["1d6", "acid"]], crit: [["1d10", "acid"]] },
  Thundering: { crit: [["1d8", "sonic"]] },
  Merciful: { nonCrit: [["1d6", "nonlethal"]] },
  Vicious: { nonCrit: [["2d6", "untyped"]] },
  Holy: { cond: { name: "神圣：对邪恶生物", damage: "2d6" } },
  Unholy: { cond: { name: "邪恶：对善良生物", damage: "2d6" } },
  Axiomatic: { cond: { name: "公理：对混乱生物", damage: "2d6" } },
  Anarchic: { cond: { name: "混沌：对守序生物", damage: "2d6" } },
  Bane: { cond: { name: "破敌", attack: "2", damageMult: "2", damage: "2d6" } },
  Keen: { keen: true },
};
const rid = () => foundry.utils.randomID(16);
// d：武器或攻击的物品数据（会被改）；fromStatblock：属性块攻击行建的，重击范围已经是属性块的（锐锋已算进去）
export async function applyEnchantMechanics(d, fromStatblock) {
  if (!["weapon", "attack"].includes(d.type) || !d.system?.actions?.length) return [];
  const list = await enchantsOf(d.name, "weapon");
  const again = !!d.flags?.["zh-monsters"]?.enchMech; // 已经加过：先清掉再加，重复执行不叠
  const done = [];
  for (const act of d.system.actions) {
    if (!/wak/.test(act.actionType || "")) continue;
    act.damage = act.damage || {};
    if (again) { act.damage.nonCritParts = []; act.damage.critParts = []; }
    act.damage.nonCritParts = act.damage.nonCritParts || [];
    act.damage.critParts = act.damage.critParts || [];
    act.conditionals = (act.conditionals || []).filter((c) => !c.name?.startsWith("附魔·"));
    for (const { rec, target } of list) {
      const m = ENCH_MECH[rec.en];
      if (!m) continue;
      for (const [f, t] of m.nonCrit || []) act.damage.nonCritParts.push({ formula: f, types: [t] });
      for (const [f, t] of m.crit || []) act.damage.critParts.push({ formula: f, types: [t] });
      if (m.cond) {
        const mods = [];
        if (m.cond.attack) mods.push({ _id: rid(), formula: m.cond.attack, target: "attack", subTarget: "allAttack", type: "untyped", damageType: [], critical: "normal" });
        if (m.cond.damageMult) mods.push({ _id: rid(), formula: m.cond.damageMult, target: "damage", subTarget: "allDamage", type: "untyped", damageType: ["untyped"], critical: "normal" });
        if (m.cond.damage) mods.push({ _id: rid(), formula: m.cond.damage, target: "damage", subTarget: "allDamage", type: "untyped", damageType: ["untyped"], critical: "nonCrit" });
        act.conditionals.push({ _id: rid(), name: `附魔·${m.cond.name}${target ? `（${target}）` : ""}`, default: false, modifiers: mods });
      }
      if (m.keen && !fromStatblock && !again && act.ability?.critRange) act.ability.critRange = 21 - 2 * (21 - act.ability.critRange);
      if (act === d.system.actions[0]) done.push(rec.zh);
    }
  }
  if (done.length) foundry.utils.setProperty(d, "flags.zh-monsters.enchMech", true);
  return done;
}

// ---- 法术书校准：施法职业/属性、施法者等级、专注、每个法术的豁免 DC，都对到属性块 ----
const addFormula = (cur, d) => {
  const n = Number(cur || 0);
  if (cur == null || cur === "" || !Number.isNaN(n)) return String((Number.isNaN(n) ? 0 : n) + d);
  return `${cur} + ${d}`;
};
// Roll Bonuses（ckl-roll-bonuses）认这些物品时看 system.flags.boolean 的键：没有键的，在建物品或打开物品表时会自动补上，
// 还会替用户选学派/武器（常选错），加值就和我们按属性块补的差值重复。所以照来源条目预先写上键、不写选项：纯 PF1 不认这些键，
// Roll Bonuses 看到有键就不再自动配置，没选项也就不加值。
const RB_KEYS = {
  "Compendium.pf1.feats.Item.n250dFlbykAIAg5Z": ["weapon-focus"],
  "Compendium.pf1.feats.Item.vWiTqHC4Y3Xn1Pme": ["bonus_finesse", "target_finesse"],
  "Compendium.pf1.feats.Item.TbOPtIL8Fv8obXtP": ["bonus_crit", "target_weapon-type"],
  "Compendium.pf1.feats.Item.zKNk7a4XxXsygJ67": ["vital-strike-greater"],
  "Compendium.pf1.feats.Item.DorPGQ2mifJbMKH8": ["vital-strike-improved"],
  "Compendium.pf1.feats.Item.26k1Gi7t5BoqxhIj": ["vital-strike"],
  "Compendium.pf1.feats.Item.53urYIbYYpQuoSLd": ["precise-shot"],
  "Compendium.pf1.feats.Item.YLCvMNeAF9V31m1h": ["weapon-specialization"],
  "Compendium.pf1.feats.Item.jKVhOxHu6VmUgFdp": ["spirited-charge"],
  "Compendium.pf1.feats.Item.IER2MzJrjSvxMlNS": ["weapon-focus-greater"],
  "Compendium.pf1.feats.Item.V2zY7BltkpSXwejy": ["spell-focus"],
  "Compendium.pf1.class-abilities.Item.ZfnHhhTFQVo0Lj4P": ["uncanny-dodge-improved"],
  "Compendium.pf1.feats.Item.asmQDyDYTtuXg8b4": ["weapon-specialization-greater"],
  "Compendium.pf1.class-abilities.Item.nKbyztRQCU5XMbbs": ["inspiration"],
  "Compendium.pf-content.pf-feats.Item.TObHyDnM6efGyLqX": ["weapon-focus-mythic"],
  "Compendium.pf-content.pf-feats.Item.rYLOl3zfFt3by3CE": ["vital-strike-mythic"],
  "Compendium.pf1.feats.Item.LSykiaxYWzva2boF": ["spell-focus-greater"],
  "Compendium.pf-content.pf-universal-monster-rules.Item.hRdJOHAkJd2G3ScN": ["flanking-immunity"],
  "Compendium.pf1.feats.Item.UcEIgufLJlIfhHmu": ["furious-focus"],
  "Compendium.pf-content.pf-racial-traits.Item.fyRBxVBVyy1gQgfV": ["swarming"],
  "Compendium.pf1.class-abilities.Item.HAqAsb5H56C6cZm3": ["versatile-performance"],
  "Compendium.pf-content.pf-feats.Item.l4yE4RGFbORuDfp7": ["elemental-focus-greater"],
  "Compendium.pf-content.pf-feats.Item.1frgqDSnQFiTq0MC": ["elemental-focus"],
  "Compendium.pf1.feats.Item.ln2Dhw97Fol1BCxU": ["outflank"],
  "Compendium.pf1e-archetypes.pf-prestige-features.Item.RmvHgVAjap4eNbPt": ["uncanny-dodge-improved"],
  "Compendium.pf1e-archetypes.pf-prestige-features.Item.WqHagtAZIfBfVUlq": ["uncanny-dodge-improved"],
  "Compendium.pf-content.pf-feats.Item.6HVdbIFcRuTq8o7p": ["snake-sidewind"],
  "Compendium.pf-content.pf-feats.Item.c6WT66xBw9y7KxUn": ["inspiration-focused"],
  "Compendium.pf1.class-abilities.Item.10EysX8x5hvz48lr": ["solo-tactics"],
  "Compendium.pf-content.pf-feats.Item.TOMEhAeZsgGHrSH6": ["spell-focus-mythic"],
};
export function rbKeys(d) {
  const keys = RB_KEYS[d._stats?.compendiumSource];
  if (!keys) return false;
  for (const k of keys) foundry.utils.setProperty(d, `system.flags.boolean.${k}`, true);
  delete d.flags?.["ckl-roll-bonuses"];
  return true;
}

// Roll Bonuses 的「武器娴熟」不用选项：用力量的天然攻击和灵巧武器，敏捷调整值更高时，它在出手时把公式里的力量换成敏捷。
// 属性块也是这么算的，所以这些攻击直接改用敏捷，再按属性块补差：纯 PF1 和装了 Roll Bonuses 的结果一样（公式里已有敏捷，它就不换）。
// 1.0.0 的攻击是在装着 Roll Bonuses 的世界里补差的，纯 PF1 下这些攻击少了敏捷和力量之差。
const FINESSE = "Compendium.pf1.feats.Item.vWiTqHC4Y3Xn1Pme";
// 能力的豁免 DC 写成 PF 的公式（10 + 半 HD + 属性调整值），属性值、HD 变了（加模板、属性伤害、增益）DC 跟着变。
// 依据：说明里写的「DC 基于X」，其次是通用规则的惯例（喷吐武器、毒素基于体质，践踏基于力量……）。
// 和属性块差的部分（能力专攻 +2、属性块本身的出入）写成常数，所以现在的数值和属性块一样。
// 不改：物品自带固定 DC 的（毒药、绊足包）、规则里就是固定 DC 的（兽化诅咒）、按职业等级算的（夺命攻击）、找不到依据的。
const ABL_ZH = { 力量: "str", 敏捷: "dex", 体质: "con", 智力: "int", 感知: "wis", 魅力: "cha" };
const DC_BASIS = [
  [/^(喷吐武器|毒素|扰乱心神|燃烧|疾病|恶臭|麻痹)(?![之])/, "con"], [/^(践踏|旋风)/, "str"],
  [/^(气势凶猛|凶威|能量吸取|能量抽离|恐惧灵氲|恐怖外貌|恐惧(?!免疫)|支配|麻痹之触|引导(负|正)能量)|凝视/, "cha"], [/^(震慑拳|渗透劲)/, "wis"],
];
export function dcFormulaUpdates(actor) {
  const hd = actor.system.attributes.hd?.total ?? 0;
  const undead = actor.system.attributes.hpAbility === "cha"; // 建怪时不死生物的 HP 和强韧都改用魅力
  const out = [], skipped = [];
  for (const it of actor.items) {
    if (!["feat", "attack"].includes(it.type) || !it.system.actions?.length) continue;
    const name = it.name.replace(/[（(].*$/, "").trim();
    const txt = (it.system.description?.value ?? "").replace(/<[^>]+>/g, "");
    const stated = txt.match(/DC[^。；]{0,40}?基于(?:其|它的|他的|她的)?\s*(力量|敏捷|体质|智力|感知|魅力)/);
    let abl = stated ? ABL_ZH[stated[1]] : DC_BASIS.find(([re]) => re.test(name))?.[1];
    const sp = it.system.abilityType === "sp" || /（Sp）|\(Sp\)/.test(it.name);
    let changed = false;
    const actions = foundry.utils.deepClone(it.system.actions);
    for (const a of actions) {
      const dc = String(a.save?.dc ?? "").trim();
      if (!a.save?.type || !/^\d+$/.test(dc)) continue;
      if (!abl) { skipped.push(`${it.name} DC ${dc}`); continue; }
      let k = abl;
      if (k === "con" && actor.system.abilities.con?.total == null) k = undead ? "cha" : null; // 不死生物的体质类 DC 用魅力；构装体没有体质就不改
      if (!k || actor.system.abilities[k]?.total == null) { skipped.push(`${it.name} DC ${dc}（没有${abl}）`); continue; }
      const mod = actor.system.abilities[k].mod;
      // 类法术能力按法术环级，不按 HD：只跟着属性走
      const base = sp ? mod : 10 + Math.floor(hd / 2) + mod;
      const off = Number(dc) - base;
      const f = sp ? `@abilities.${k}.mod` : `10 + floor(@attributes.hd.total / 2) + @abilities.${k}.mod`;
      a.save.dc = off ? `${f} ${off > 0 ? "+" : "-"} ${Math.abs(off)}` : f;
      changed = true;
    }
    if (changed) out.push({ _id: it.id, "system.actions": actions });
  }
  return { updates: out, skipped };
}

// 天生攻击的伤害骰写成 PF1 的 sizeRoll：起始体型是这只怪现在的体型，所以现在掷出来和属性块一样（大型的 2d8 还是 2d8）；
// 体型变了（变巨术、模板、变形）按 PF1 的体型骰表跟着变。只换开头那一段骰子，后面的常数（补差）不动。
export function naturalSizeUpdates(actor) {
  const sz = actor.system.traits.size?.base ?? actor.system.traits.size;
  const idx = Object.keys(pf1.config.sizeChart).indexOf(sz);
  if (idx < 0) return [];
  const out = [];
  for (const it of actor.items) {
    if (it.type !== "attack" || it.system.subType !== "natural") continue;
    const actions = foundry.utils.deepClone(it.system.actions);
    let n = 0;
    for (const a of actions) {
      for (const part of a.damage?.parts ?? []) {
        const m = String(part.formula ?? "").match(/^\s*(\d+)d(\d+)(?![\d(])/);
        if (!m || m[2] === "1") continue; // 1d1：sizeRoll 会直接变成常数 1，留原样
        part.formula = `sizeRoll(${m[1]}, ${m[2]}, @size, ${idx})` + part.formula.slice(m[0].length);
        n++;
        break; // 只换第一段（基础伤害），附加的能量伤害等不随体型变
      }
    }
    if (n) out.push({ _id: it.id, "system.actions": actions });
  }
  return out;
}

export function finesseDexUpdates(actor) {
  if (!actor.items.some((i) => i._stats?.compendiumSource === FINESSE || i.system.flags?.boolean?.bonus_finesse)) return [];
  const { dex, str } = actor.system.abilities;
  if ((dex?.mod ?? 0) <= (str?.mod ?? 0)) return [];
  const out = [];
  for (const it of actor.items) {
    if (!["attack", "weapon"].includes(it.type)) continue;
    const natural = !!it.system.weaponGroups?.total?.has?.("natural") || it.system.subType === "natural";
    if (!natural && !it.system.properties?.fin) continue; // 和 Roll Bonuses 的 FinesseTarget 同一判定
    if (it.defaultAction?.ability?.attack !== "str") continue;
    const actions = foundry.utils.deepClone(it.system.actions);
    let n = 0;
    for (const a of actions) { // 原始数据常是 "_default"（武器默认近战用力量），按系统解析后的值判断
      if ((it.actions?.get(a._id)?.ability?.attack ?? a.ability?.attack) !== "str") continue;
      a.ability.attack = "dex";
      n++;
    }
    if (n) out.push({ _id: it.id, "system.actions": actions });
  }
  return out;
}

export async function calibrateSpells(actor, p, log) {
  const res = { dcFixed: 0, concFixed: 0, clFixed: 0, ablFixed: 0 };
  const path = (k) => `system.attributes.spells.spellbooks.${k}`;
  // 1) 主法术书挂在会施法的职业上，属性按职业（已建好的怪原地修用；新建的在 spellItems 里已经这样）
  if (p.spells && actor.system.attributes.spells.spellbooks.primary?.inUse) {
    const casters = actor.items.filter((i) => i.type === "class" && i.system.subType !== "racial" && i.system.casting?.type);
    const named = casters.find((c) => (p.spells.title || "").includes(c.name.replace(/[（(].*$/, "").trim()));
    const cls = named || [...casters].sort((x, y) => (y.system.level || 0) - (x.system.level || 0))[0];
    const b = actor._source.system.attributes.spells.spellbooks.primary;
    const upd = {};
    if (cls && b.class !== cls.system.tag) upd[`${path("primary")}.class`] = cls.system.tag;
    const abl = cls?.system?.casting?.ability;
    if (abl && b.ability !== abl) upd[`${path("primary")}.ability`] = abl;
    if (Object.keys(upd).length) { await actor.update(upd); res.ablFixed++; log.push(`法术书职业/属性：${JSON.stringify(upd)}`); }
  }
  // 2) 施法者等级、3) 专注
  for (const [key, bk] of [["spelllike", p.sla], ["primary", p.spells]]) {
    const b = actor.system.attributes.spells.spellbooks[key];
    if (!bk || !b?.inUse) continue;
    const src = actor._source.system.attributes.spells.spellbooks[key] || {};
    const upd = {};
    const wantCL = bk.cl ?? actor.system.attributes.hd.total;
    if (b.cl?.total != null && b.cl.total !== wantCL) { upd[`${path(key)}.cl.formula`] = addFormula(src.cl?.formula, wantCL - b.cl.total); res.clFixed++; }
    if (Object.keys(upd).length) await actor.update(upd);
    const b2 = actor.system.attributes.spells.spellbooks[key];
    if (bk.concentration != null && b2.concentration?.total != null && b2.concentration.total !== bk.concentration) {
      const src2 = actor._source.system.attributes.spells.spellbooks[key] || {};
      await actor.update({ [`${path(key)}.concentrationFormula`]: addFormula(src2.concentrationFormula, bk.concentration - b2.concentration.total) });
      res.concFixed++;
    }
  }
  // 4) 每个法术的豁免 DC：系统算的是 10 + 环级 + 属性调整，属性块不同的（种族加值、专长、写法另算）差值写进法术动作的「豁免 DC」附加值
  const itemUpd = [];
  for (const [key, bk] of [["spelllike", p.sla], ["primary", p.spells]]) {
    if (!bk) continue;
    const want = new Map();
    for (const g of bk.groups || []) for (const s of g.spells || []) if (s.dc && s.uuid && !want.has(s.uuid)) want.set(s.uuid, s.dc);
    for (const it of actor.items.filter((i) => i.type === "spell" && i.system.spellbook === key)) {
      const w = want.get(it._stats?.compendiumSource);
      const act = it.defaultAction ?? it.firstAction;
      if (!w || !act || !act.save?.type) continue;
      const dc = act.getDC?.();
      if (typeof dc !== "number" || dc === w) continue;
      const acts = it.toObject().system.actions;
      const a0 = acts.find((x) => x._id === act.id) || acts[0];
      a0.save = { ...(a0.save || {}), dc: addFormula(a0.save?.dc, w - dc) };
      itemUpd.push({ _id: it.id, "system.actions": acts });
    }
  }
  if (itemUpd.length) { await actor.updateEmbeddedDocuments("Item", itemUpd); res.dcFixed = itemUpd.length; }
  if (res.clFixed || res.concFixed || res.dcFixed) log.push(`法术校准：施法者等级 ${res.clFixed}、专注 ${res.concFixed}、豁免 DC ${res.dcFixed} 条`);
  return res;
}
// 核对：每本法术书的施法者等级/专注，每个有 DC 的法术
export function spellCheck(actor, p) {
  const bad = [];
  for (const [key, bk] of [["spelllike", p.sla], ["primary", p.spells]]) {
    const b = actor.system.attributes.spells.spellbooks[key];
    if (!bk || !b?.inUse) continue;
    const wantCL = bk.cl ?? actor.system.attributes.hd.total;
    if (b.cl.total !== wantCL) bad.push(`${key} CL ${b.cl.total}≠${wantCL}`);
    if (bk.concentration != null && b.concentration?.total !== bk.concentration) bad.push(`${key} 专注 ${b.concentration?.total}≠${bk.concentration}`);
    const want = new Map();
    for (const g of bk.groups || []) for (const s of g.spells || []) if (s.dc && s.uuid && !want.has(s.uuid)) want.set(s.uuid, s.dc);
    for (const it of actor.items.filter((i) => i.type === "spell" && i.system.spellbook === key)) {
      const w = want.get(it._stats?.compendiumSource);
      const act = it.defaultAction ?? it.firstAction;
      if (!w || !act?.save?.type) continue;
      const dc = act.getDC?.();
      if (dc !== w) bad.push(`${it.name} DC ${dc}≠${w}`);
    }
  }
  return bad;
}

export async function buildOne(p, folder) {
  const log = [];
  const actor = await Actor.create(baseActorData(p, folder));
  const cur = {};
  for (const g of p.gearList || []) if (g.currency) cur[g.currency] = (cur[g.currency] || 0) + g.qty;
  if (Object.keys(cur).length) await actor.update(Object.fromEntries(Object.entries(cur).map(([k, v]) => [`system.currency.${k}`, v])));
  const base = await itemsFor(p, log);
  const atks = await attackItems(p, log);
  base.push(...atks);
  // 装备栏里写了数量的兵器（「4 支标枪」）：数量记到攻击建出的那把上
  for (const g of p.gearList || []) {
    const w = atks.find((x) => x.type === "weapon" && x.flags["zh-monsters"].target.name === g.zh);
    if (w && g.qty > 1) w.system.quantity = g.qty;
  }
  base.push(...(await gearItems(p, new Set(atks.filter((a) => a.type === "weapon").flatMap((a) => [a.flags["zh-monsters"].target.name, a.flags["zh-monsters"].target.name.replace(/\s+/g, ""), gearKey(a.flags["zh-monsters"].target.name)])), log)));
  base.push(...(await ammoItems(base, log)));
  base.unshift(await raceItem(p, log));
  for (const d of base) {
    if (enchKind(d)) d.name = await normalizeEnchantName(d.name); // 只改武器、弹药、护甲、盾牌（「防御护腕」是奇物，不能改成「护体护腕」）
    const v = await withEnchants(d); // 魔法武器/护甲名字里的特殊能力：规则说明附在物品说明后面
    if (v != null) foundry.utils.setProperty(d, "system.description.value", v);
  }
  for (const d of base) {
    const m = await applyEnchantMechanics(d, !!d.flags?.["zh-monsters"]?.target); // 炽焰 +1d6 火焰（不倍增）、焰爆重击 +1d10、神圣/破敌条件加值……
    if (m.length) log.push(`附魔效果：${d.name}（${m.join("、")}）`);
  }
  // 持有的武器都显示在战斗栏（PF1 默认只在物品栏，战斗栏只列攻击）
  for (const d of base) if (d.type === "weapon") d.system.showInCombat = true;
  // 持有的武器、护甲、衣物照生物的体型（大型食人魔的巨木棒是大型的）：重量按体型算；伤害骰是属性块写死的，不受影响
  for (const d of base) if (["weapon", "equipment"].includes(d.type) && p.size) d.system.size = p.size;
  for (const d of base) rbKeys(d);
  for (const d of base) if (d.type !== "class") foundry.utils.setProperty(d, "flags.zh-monsters.mine", true);
  await assignTags(base);
  // 职业物品创建时会按 classAssociations 自动补职业特性；属性块里已经有的就从清单里去掉，免得同一特性出现两份
  // （PF1 会报「发现重复的物品标识符 classFeat_xxx」）
  const mineSrc = new Set(base.filter((d) => d.type !== "class").map((d) => d._stats?.compendiumSource).filter(Boolean));
  const mineTag = new Set(base.filter((d) => d.type === "feat").map((d) => d.system?.tag?.toLowerCase()).filter(Boolean)); // 只比能力：攻击「徒手打击」和武僧的职业特性同名，不是重复
  for (const d of base.filter((x) => x.type === "class")) {
    const links = d.system?.links?.classAssociations;
    if (!Array.isArray(links) || !links.length) continue;
    const keep = [];
    for (const l of links) {
      if (mineSrc.has(l.uuid)) continue;
      const tag = (await fromUuid(l.uuid).catch(() => null))?.system?.tag;
      if (tag && mineTag.has(tag.toLowerCase())) continue; // 我们按英文名生成的是 scribeScroll，职业特性里是 ScribeScroll
      keep.push(l);
    }
    d.system.links.classAssociations = keep;
  }
  await actor.createEmbeddedDocuments("Item", base);
  const { items: spells, bookUpdates } = await spellItems(p, actor, log);
  if (Object.keys(bookUpdates).length) await actor.update(bookUpdates);
  for (const d of spells) foundry.utils.setProperty(d, "flags.zh-monsters.mine", true);
  if (spells.length) await actor.createEmbeddedDocuments("Item", spells);
  await fixAbilities(actor, p, log);
  await dedupeClassFeatures(actor, log);
  const skillChanges = await skillRanks(actor, p, log);
  await adjust(actor, p, log); // HP、种族生命骰豁免进度
  await iterateAdjust(actor, p, log, skillChanges);
  const fin = finesseDexUpdates(actor);
  if (fin.length) { await actor.updateEmbeddedDocuments("Item", fin); log.push(`武器娴熟：${fin.length} 个攻击改用敏捷`); }
  await attackAdjust(actor, log);
  const nat = naturalSizeUpdates(actor); // 天生攻击伤害骰随体型变
  if (nat.length) { await actor.updateEmbeddedDocuments("Item", nat); log.push(`天生攻击 sizeRoll：${nat.length} 个`); }
  // 调职业等级时系统又会补上该等级的职业特性：再去一次重，删了东西就重新补差
  for (let k = 0; k < 3 && (await dedupeClassFeatures(actor, log)); k++) await iterateAdjust(actor, p, log, skillChanges); // 补差又调了等级就再来一次
  // 攻击和职业特性同名（武僧的徒手打击）：攻击的标识符加 Attack，免得同一只怪里两个标识符一样
  const featTags = new Set(actor.items.filter((i) => i.type === "feat" && i.system.tag).map((i) => i.system.tag.toLowerCase()));
  const allTags = new Set(actor.items.filter((i) => i.system?.tag).map((i) => i.system.tag.toLowerCase()));
  const atkTag = [];
  for (const i of actor.items) {
    if (i.type !== "attack" || !i.system.tag || !featTags.has(i.system.tag.toLowerCase())) continue;
    let t = i.system.tag + "Attack";
    for (let k = 2; allTags.has(t.toLowerCase()); k++) t = i.system.tag + "Attack" + k;
    allTags.add(t.toLowerCase());
    atkTag.push({ _id: i.id, "system.tag": t });
  }
  if (atkTag.length) await actor.updateEmbeddedDocuments("Item", atkTag);
  await calibrateSpells(actor, p, log); // 法术书职业/属性、施法者等级、专注、豁免 DC 对到属性块
  const dcf = dcFormulaUpdates(actor); // 能力 DC 写成公式（数值不变，属性和 HD 变了会跟着变）
  if (dcf.updates.length) { await actor.updateEmbeddedDocuments("Item", dcf.updates); log.push(`DC 公式：${dcf.updates.length} 个能力`); }
  // 杂项能力归到种族特性：种族生命骰自动带的黑暗视觉、昏暗视觉等；只留「属性块修正」在杂项
  const toRacial = actor.items.filter((i) => i.type === "feat" && i.system.subType === "misc" && i.name !== ADJ_NAME).map((i) => ({ _id: i.id, "system.subType": "racial" }));
  if (toRacial.length) await actor.updateEmbeddedDocuments("Item", toRacial);
  // 专长数：属性块的专长常含奖励专长（职业、模板、种族给的），超过「生命骰/2 + 神话」的部分记进奖励专长公式
  const fc = actor.getFeatCount();
  if (fc.excess > 0) {
    await actor.update({ "system.details.bonusFeatFormula": String(fc.excess) });
    log.push(`奖励专长 +${fc.excess}（属性块专长 ${fc.active}，系统按生命骰只给 ${fc.max}）`);
  }
  // 最终核对
  const A = actor.system.attributes;
  const check = {
    hp: [A.hp.max, p.hp.total], ac: [A.ac.normal.total, p.ac.normal], touch: [A.ac.touch.total, p.ac.touch], ff: [A.ac.flatFooted.total, p.ac.ff],
    fort: [A.savingThrows.fort.total, p.saves.fort], ref: [A.savingThrows.ref.total, p.saves.ref], will: [A.savingThrows.will.total, p.saves.will],
    bab: [A.bab.total, p.bab], cmb: [A.cmb.total, p.cmb], cmd: [A.cmd.total, p.cmd], init: [A.init.total, p.init],
  };
  for (const [k, v] of Object.entries(p.abilities)) if (v != null) check[k] = [actor.system.abilities[k].total, v];

  const bad = Object.entries(check).filter(([k, [a, b]]) => b != null && a !== b).map(([k, [a, b]]) => `${k} ${a}≠${b}`);
  bad.push(...spellCheck(actor, p));
  for (const s of p.skills) {
    const path = subPaths(p)[p.skills.indexOf(s)];
    const sk = foundry.utils.getProperty(actor.system.skills, path);
    if (sk && sk.mod !== s.total) bad.push(`技能 ${s.key} ${sk.mod}≠${s.total}`);
  }
  return { id: actor.id, name: actor.name, log, bad };
}

export async function buildAll(plans, folder) {
  const res = [];
  for (const p of plans) {
    try {
      res.push(await buildOne(p, folder));
    } catch (e) {
      res.push({ name: p.en, error: e.message, stack: e.stack?.split("\n").slice(0, 3).join(" | ") });
    }
  }
  return res;
}


// ---------------- 补充合集包 ----------------
const SUPP = "pf1-zh-monsters.supplement";
const SUPP_FOLDER = { potion: "药水", scroll: "卷轴", wand: "魔杖", attack: "攻击", ability: "特殊能力" };
const CONS_ZH = { potion: "药水", scroll: "卷轴", wand: "魔杖" };
const CONS_EN = { potion: "Potion of", scroll: "Scroll of", wand: "Wand of" };

// 照 supplement.json 建补充合集包里还没有的条目（id 固定，由 Python 的 supp_ids.py 算出）
export async function syncSupplement({ update = false } = {}) {
  const list = await fetch("/zh-monsters/supplement.json?" + Date.now()).then((r) => r.json());
  const pack = game.packs.get(SUPP);
  await pack.configure({ locked: false });
  const have = new Set((await pack.getIndex()).map((e) => e._id));
  const folders = {};
  for (const f of pack.folders) folders[f.name] = f.id;
  for (const n of Object.values(SUPP_FOLDER)) {
    if (!folders[n]) {
      const [f] = await Folder.createDocuments([{ name: n, type: "Item", sorting: "a" }], { pack: pack.collection });
      folders[n] = f.id;
    }
  }
  const datas = [], errors = [];
  for (const e of list) {
    if (have.has(e._id) && !update) continue;
    let d = null;
    try {
      if (e.kind === "consumable") {
        const sp = await fromUuid(e.spell);
        if (!sp) { errors.push(`法术不存在：${e.spell}`); continue; }
        const sd = sp.toObject();
        if (e.cl) sd.cl = e.cl;
        d = await pf1.documents.item.ItemSpellPF.toConsumable(sd, e.type);
        const m = sp.name.match(/^(.*?)\s*\((.*)\)$/);
        const zh = m ? m[1] : sp.name, en = m ? m[2] : sp.name;
        d.name = `${zh}${CONS_ZH[e.type]}${e.cl ? `（CL ${e.cl}）` : ""} (${CONS_EN[e.type]} ${en})`;
        d.folder = folders[SUPP_FOLDER[e.type]];
      } else if (e.kind === "attack") {
        d = { name: e.name, type: "attack", img: e.img || "icons/svg/sword.svg",
          system: { subType: "natural", description: { value: e.description || "" },
            actions: [{ _id: foundry.utils.randomID(16), name: "攻击", actionType: e.ranged ? "rwak" : "mwak",
              activation: { type: "attack", unchained: { type: "attack" } }, range: { units: e.ranged ? "ft" : "melee", value: e.range || null },
              ability: { attack: e.ranged ? "dex" : "str", damage: e.ranged ? null : "str", damageMult: 1 },
              damage: { parts: [{ formula: "1d6", types: e.damageTypes || [] }] }, touch: !!e.touch }] },
          folder: folders.攻击 };
      } else if (e.kind === "ability") {
        d = { name: e.name, type: "feat", img: e.img || "icons/svg/aura.svg",
          system: { subType: "misc", abilityType: e.abilityType || "none", description: { value: e.description || "" } },
          folder: folders.特殊能力 };
      }
    } catch (err) { errors.push(`${e.key}：${err.message}`); continue; }
    if (!d) continue;
    d._id = e._id;
    d.flags = { ...(d.flags || {}), "zh-monsters": { key: e.key } };
    datas.push(d);
  }
  const ids = new Set(datas.map((d) => d._id));
  // 清单里已经没有的条目删掉
  const keep = new Set(list.map((e) => e._id));
  const stale = [...have].filter((id) => !keep.has(id));
  if (stale.length) await Item.deleteDocuments(stale, { pack: pack.collection });
  if (update) {
    const old = [...ids].filter((id) => have.has(id));
    if (old.length) await Item.deleteDocuments(old, { pack: pack.collection });
  }
  for (let i = 0; i < datas.length; i += 50) await Item.createDocuments(datas.slice(i, i + 50), { pack: pack.collection, keepId: true });
  return { created: datas.length, total: list.length, errors };
}
