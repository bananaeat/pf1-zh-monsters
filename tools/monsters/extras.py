"""plan.py 的补充：防御拆分、能力全文来源、图标。"""
import pickle
import re
from pathlib import Path

ENERGY = {"酸蚀": "acid", "酸": "acid", "强酸": "acid", "寒冷": "cold", "冰冷": "cold", "电击": "electric", "闪电": "electric",
          "火焰": "fire", "火": "fire", "音波": "sonic", "声波": "sonic"}
DR_TYPE = {"魔法": "magic", "史诗": "epic", "寒铁": "coldIron", "秘银": "mithral", "银": "silver", "精金": "adamantine",
           "善良": "good", "邪恶": "evil", "守序": "lawful", "秩序": "lawful", "混乱": "chaotic",
           "钝击": "bludgeoning", "穿刺": "piercing", "挥砍": "slashing"}
# 状态免疫：PF1 的 conditionTypes 键
CI = {"毒素": "poison", "毒": "poison", "疾病": "disease", "麻痹": "paralyze", "睡眠": "sleep", "魔法睡眠": "sleep", "震慑": "stun",
      "恐惧": "fear", "影响心灵": "mindAffecting", "心灵效果": "mindAffecting", "心智效果": "mindAffecting", "死亡效果": "deathEffects",
      "石化": "petrify", "变形": "polymorph", "能量吸取": "energyDrain", "目盲": "blind", "耳聋": "deaf", "晕眩": "daze",
      "疲乏": "fatigue", "力竭": "exhausted", "恶心": "sicken", "流血": "bleed", "困惑": "confuse", "诅咒": "curse",
      "士气效果": "moraleEffects", "目眩": "dazzle"}


def parse_defenses(r, split_top, links_to_names):
    """免疫→伤害免疫(di)/状态免疫(ci)，抗力→能量抗力(eres)，弱点→易伤(dv)，伤害减免→dr；拆不了的放 notes。"""
    di, ci, dv, eres, dr, notes = [], [], [], [], [], []
    for part in split_top(links_to_names(r.get("immune") or ""), ";；，,"):
        p = part.strip()
        if not p or "特性" in p:
            continue  # 「不死生物特性」之类由对应的通用规则能力条目负责
        if p in ENERGY:
            di.append(ENERGY[p])
        elif p in CI:
            ci.append(CI[p])
        elif p.endswith("效果") and p[:-2] in CI:
            ci.append(CI[p[:-2]])
        else:
            ci.append(p)  # 其他（如「精准伤害」）PF1 允许直接写文字
    for part in split_top(links_to_names(r.get("resist") or ""), ";；，,"):
        m = re.match(r"^(?:(\D+?)\s*(\d+)|(\d+)\s*(\D+?))$", part.strip())
        name = ((m.group(1) or m.group(4)) or "").strip() if m else ""
        if m and name in ENERGY:
            eres.append({"amount": int(m.group(2) or m.group(3)), "types": [ENERGY[name], ""], "operator": True})
        else:
            notes.append(f"抗力：{part}")
    for part in split_top(links_to_names(r.get("weaknesses") or ""), ";；，,"):
        m = re.search("(" + "|".join(ENERGY) + ")", part)
        if m and re.search(r"易受|易伤|弱点", part):
            dv.append(ENERGY[m.group(1)])
        else:
            notes.append(f"弱点：{part}")
    for part in split_top(links_to_names(r.get("dr") or ""), ";；，,"):
        m = re.match(r"^\s*(\d+)\s*/\s*(.+)$", part)
        if not m:
            notes.append(f"伤害减免：{part}")
            continue
        amt, rest = int(m.group(1)), m.group(2).strip()
        if rest in ("–", "-", "—"):
            dr.append({"amount": amt, "types": ["", ""], "operator": True})
            continue
        parts = [x.strip() for x in re.split(r"或|和", rest)]
        types = [DR_TYPE.get(x) for x in parts]
        if None in types or len(types) > 2:
            notes.append(f"伤害减免：{part}")
            continue
        dr.append({"amount": amt, "types": (types + [""])[:2], "operator": "和" not in rest})
    return {"di": di, "ci": ci, "dv": dv, "eres": eres, "dr": dr, "notes": notes}


_PAGE_ABIL = None


def page_abilities(E, special_abilities):
    """同一维基页面上所有属性块的特殊能力（成年白龙的冰行写在白龙总条目里），以及怪物绪论里的能力。"""
    global _PAGE_ABIL
    if _PAGE_ABIL is None:
        _PAGE_ABIL = {}
        for e in E["creatures"]:
            for a in special_abilities(e["raw"].get("special_abilities")):
                _PAGE_ABIL.setdefault(e["title"], {}).setdefault(a["name"], a)
        for e in E.get("creature_lore", []):
            txt = (e["raw"].get("lore") or "") + "\n" + (e["raw"].get("description") or "")
            for m in re.finditer(r"'''([^'\n]{1,12})'''\s*[（(]\s*(Ex|Su|Sp)\s*[）)]\s*[：:]\s*([^\n]+)", txt):
                _PAGE_ABIL.setdefault(e["title"], {}).setdefault(m.group(1), {"name": m.group(1), "type": m.group(2), "text": m.group(3)})
            for a in special_abilities(txt):
                _PAGE_ABIL.setdefault(e["title"], {}).setdefault(a["name"], a)
        # 怪物模板（巫妖、吸血鬼……）里的能力：「名字（Su）：说明」逐行写
        for e in E.get("creature_templates", []):
            keys = [e["title"], e["raw"].get("name") or "", e["raw"].get("english_name") or ""]
            for fld in ("special_attacks", "special_abilities", "defense", "abilities", "intro"):
                for a in special_abilities(e["raw"].get(fld) or ""):
                    for k in keys:
                        if k:
                            _PAGE_ABIL.setdefault("模板:" + k, {}).setdefault(a["name"], a)
                for m in TPL_ABIL.finditer(e["raw"].get(fld) or ""):
                    nm = m.group(1).strip().strip("'*").strip()
                    for k in keys:
                        if k:
                            _PAGE_ABIL.setdefault("模板:" + k, {}).setdefault(nm, {"name": nm, "type": m.group(2), "text": m.group(3)})
    return _PAGE_ABIL


TPL_ABIL = re.compile(r"(?:^|\n)[\s*']*([^'\n：:（(]{2,12}?)[\s']*[（(]\s*(Ex|Su|Sp)\s*[）)]\s*[：:]\s*([^\n]+)")


_CHM_REV = None


def chm_en(zh):
    """CHM 中英对照反查：中文能力名 → 最常见的英文名（凶威 → Frightful Presence）。"""
    global _CHM_REV
    if _CHM_REV is None:
        pairs = pickle.loads(Path(r"E:/FoundryV13/zh-build/chm_pairs.pkl").read_bytes())
        _CHM_REV = {}
        for en, zhs in pairs.items():
            for z, n in zhs.items():
                if n > _CHM_REV.get(z, ("", 0))[1]:
                    _CHM_REV[z] = (en, n)
    return (_CHM_REV.get(zh) or (None, 0))[0]


ICON_ROOTS = [("icons/magic", Path(r"E:/FoundryV13/app/public/icons/magic")),
              ("icons/creatures", Path(r"E:/FoundryV13/app/public/icons/creatures"))]
ICON_KEYS = [  # 中文关键词 → 核心图标文件名关键词，按顺序匹配
    (r"树|木|植物|藤", r"tree|plant|vine|nature"),
    (r"冰|寒|雪|霜", r"ice|snow|frost"), (r"火|焰|燃|灼", r"fire|flame"), (r"电|雷|闪电", r"lightning"), (r"酸", r"acid"),
    (r"音|声|吼|嚎|尖啸|歌", r"sonic|sound|scream"), (r"毒", r"poison|toxic|venom"), (r"疾病|热疫|腐", r"disease|rot|decay"),
    (r"凝视|目|眼|视", r"eye"), (r"恐惧|凶威|惊|吓", r"^fear-fright"), (r"灵光|灵氲|光环|气场", r"aura"),
    (r"再生|治疗|愈", r"heal|regen|heart"), (r"飞|翼|翅", r"wing|feather"), (r"隐|藏|伪装|融", r"invisib|shadow|hidden|camo"),
    (r"抗|免疫|护|屏障|减免", r"shield|barrier|ward|defen"), (r"变形|外形|形态|变身", r"transform|shape|morph"),
    (r"召唤|传送|位面", r"portal|summon|teleport"), (r"吸取|吸血|吸", r"drain|blood|vampir"), (r"黏|胶|泥", r"slime|ooze|goo"),
    (r"石化|石|岩", r"stone|rock|petri"), (r"麻痹|定身", r"paraly|hold|chain"), (r"心灵|心智|魅惑|支配|暗示", r"mind|brain|charm"),
    (r"光|阳", r"light|sun"), (r"暗|影|夜", r"dark|shadow|night"), (r"死|亡|不死|墓", r"^(death|undead|skull)"),
(r"水|游|潜", r"water|wave"), (r"风|气", r"air|wind"),
    (r"嗅|闻", r"nose|smell"), (r"咬|牙", r"bite|fang|teeth"), (r"爪", r"claw"),
]
_ICONS = None


def pick_icon(name, text=""):
    """按能力名（其次描述开头）里的关键词，在 Foundry 核心图标库里挑一个文件名匹配的图标。"""
    global _ICONS
    if _ICONS is None:
        _ICONS = []
        for prefix, root in ICON_ROOTS:
            _ICONS += [prefix + "/" + f.relative_to(root).as_posix() for f in sorted(root.rglob("*.webp"))]
    for src in (name, text[:60]):
        for zh_re, en_re in ICON_KEYS:
            if re.search(zh_re, src):
                hits = [i for i in _ICONS if re.search(en_re, i.rsplit("/", 1)[-1])]
                if hits:
                    return min(hits, key=len)
    return "icons/magic/symbols/runes-star-pentagon-blue.webp"


# ---------- 能力动作参数（喷吐、凝视、灵光、毒素……） ----------
SAVE_TYPE = {"强韧": "fort", "反射": "ref", "意志": "will"}
TEMPLATE = [("锥形", "cone"), ("锥状", "cone"), ("直线", "ray"), ("线形", "ray"), ("线状", "ray"), ("半径", "circle"),
            ("爆发", "circle"), ("扩散", "circle"), ("散发", "circle")]


def action_params(raw_line, text="", name=""):
    """从属性块那一行（其次是能力全文）解析 DC、豁免、范围、伤害、持续时间，给能力的动作用。"""
    src = raw_line or ""
    plain = re.sub(r"<[^>]+>", "", text or "")
    out = {}
    m = re.search(r"DC\s*(\d+)", src) or re.search(r"DC\s*(\d+)", plain)
    if m:
        out["dc"] = m.group(1)
    for zh, key in SAVE_TYPE.items():
        if zh in src or (zh in plain[:200] and "dc" in out):
            out["saveType"] = key
            break
    both = src + " " + plain[:200]
    if "减半" in both:
        out["saveDesc"] = "通过则伤害减半"
    elif re.search(r"无效|忽视|抵抗", both):
        out["saveDesc"] = "通过则无效"
    m = re.search(r"半径\s*(\d+)\s*尺()", src) or re.search(r"(\d+)\s*尺\s*(锥形|锥状|直线|线形|线状|半径|爆发|扩散|散发)?", src)
    if m:
        shape = next((v for k, v in TEMPLATE if m.group(2) and k in m.group(2)), None)
        if "半径" in src[:m.end()] or re.search(r"灵氲|灵光|凶威|气势", src[:m.start()] + name):
            shape = "circle"  # 以自身为中心的范围
        if shape:
            out["template"] = {"type": shape, "size": m.group(1)}
        else:
            out["range"] = m.group(1)
    m = re.search(r"(\d+d\d+(?:\s*[+\-]\s*\d+)?)(?![\s+\-\d]*(?:轮|分钟|小时|天))\s*(?:点)?\s*(火焰|寒冷|电击|闪电|酸蚀|强酸|音波|负能量|正能量)?", src)
    if m:
        out["damage"] = {"formula": m.group(1).replace(" ", ""), "types": [ENERGY.get(m.group(2), {"负能量": "negative", "正能量": "positive"}.get(m.group(2)))] if m.group(2) else []}
    m = re.search(r"(\d+d\d+(?:\s*[+\-]\s*\d+)?|\d+)\s*轮", src)
    if m and "每" not in src[max(0, m.start() - 2):m.start()]:
        out["duration"] = {"units": "round", "value": m.group(1).replace(" ", "")}
    m = re.search(r"每\s*(\d*d\d+)\s*轮", src + plain[:300])
    if m:
        out["recharge"] = m.group(1)
    return out
