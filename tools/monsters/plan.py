"""PFWiki 中文怪物属性块 → 「建造计划」JSON（交给 Foundry 里的 build_actor.js 搭角色、补差）。

计划里只放解析结果和要引用的合集包 uuid；数值最终以游戏里 PF1 自己的计算为准，差多少由 JS 端补。
python plan.py                 生成样板 20 只
python plan.py "Goblin" ...    只生成指定英文名
"""
import json
import pickle
import re
import sys
from pathlib import Path

sys.path.insert(0, r"E:/FoundryV13/zh-build/src")
from wiki import norm, name_variants, w2h  # noqa: E402
import extras  # noqa: E402
from supp_ids import supp_uuid  # noqa: E402

ROOT = Path(r"E:/FoundryV13/monsters")
OUT = Path(r"E:/FoundryV13/data/Data/zh-monsters/plans.json")
IDX = json.loads((ROOT / "index.json").read_text(encoding="utf8"))
G, TITLE_EN, REDIR = IDX["groups"], IDX["title_en"], IDX["redirects"]
# 旧译名 → 现行条目（aliases/<组>.json，值是该组的中文名或英文名；null = 确认合集包里没有）
ALIASF = {f.stem: json.loads(f.read_text(encoding="utf8")) for f in (ROOT / "aliases").glob("*.json")}

SAMPLES = ["Goblin", "Rat, Dire", "Wolf", "Skeleton", "Zombie", "Ghoul", "Orc", "Ogre", "Owlbear", "Minotaur", "Troll", "Harpy",
           "Gelatinous Cube", "Basilisk", "Medusa", "Demon, Succubus", "Giant, Hill", "Dryad", "Lich", "Adult White Dragon"]

SIZE = {"超微型": "fine", "微型": "dim", "超小型": "tiny", "小型": "sm", "中型": "med", "大型": "lg", "超大型": "huge", "巨型": "grg", "超巨型": "col"}
ALIGN = {"守序善良": "lg", "中立善良": "ng", "混乱善良": "cg", "守序中立": "ln", "绝对中立": "tn", "中立": "tn", "混乱中立": "cn",
         "守序邪恶": "le", "中立邪恶": "ne", "混乱邪恶": "ce"}
TYPE_EN = {"异怪": "Aberration", "动物": "Animal", "构装体": "Construct", "龙类": "Dragon", "龙": "Dragon", "精类": "Fey",
           "类人生物": "Humanoid", "魔法兽": "Magical Beast", "人形怪物": "Monstrous Humanoid", "泥形生物": "Ooze", "泥怪": "Ooze",
           "异界生物": "Outsider", "植物": "Plant", "不死生物": "Undead", "虫类": "Vermin"}
SKILL = {"特技": "acr", "估价": "apr", "唬骗": "blf", "攀爬": "clm", "手艺": "crf", "工艺": "crf", "交涉": "dip", "解除装置": "dev",
         "易容": "dis", "脱逃": "esc", "逃脱": "esc", "飞行": "fly", "驯养动物": "han", "医疗": "hea", "威吓": "int", "语言学": "lin",
         "察觉": "per", "表演": "prf", "职业": "pro", "专业": "pro", "骑术": "rid", "察言观色": "sen", "巧手": "slt", "法术辨识": "spl", "隐匿": "ste",
         "生存": "sur", "游泳": "swm", "使用魔法装置": "umd", "魔法装置": "umd"}
KNOW = {"奥术": "kar", "奥秘": "kar", "地城": "kdu", "地下城": "kdu", "工程": "ken", "工程学": "ken", "地理": "kge", "历史": "khi",
        "地方": "klo", "本地": "klo", "自然": "kna", "贵族": "kno", "位面": "kpl", "宗教": "kre"}
NATURAL = {"啮咬": "Bite", "咬": "Bite", "爪抓": "Claw", "爪击": "Claw", "爪": "Claw", "抵撞": "Gore", "顶撞": "Gore", "撞击": "Slam",
           "拍击": "Slam", "猛击": "Slam", "触手": "Tentacle", "利爪": "Talon", "钩爪": "Talon", "蜇刺": "Sting", "螫刺": "Sting",
           "翼拍": "Wing", "翼击": "Wing", "钳": "Pincer", "钳击": "Pincer", "螯夹": "Pincer", "尾拍": "Tail Slap", "尾击": "Tail Slap",
           "蹄": "Hoof", "蹄踢": "Hoof", "蹄击": "Hoof", "群集": "Swarm Attack", "徒手打击": "Unarmed Strike",
           "挥击": "Slam", "钉刺": "Sting", "针刺": "Sting", "针蜇": "Sting", "尾针": "Sting", "角抵": "Gore", "触腕": "Tentacle",
           "触须": "Tentacle", "卷须": "Tentacle", "抓击": "Claw", "喙啄": "Bite", "扫尾": "Tail Slap", "爪": "Claw",
           "钳子": "Pincer", "螯钳": "Pincer", "翼": "Wing", "尾刺": "Sting", "集群": "Swarm Attack", "虫群": "Swarm Attack"}
SENSE = {"黑暗视觉": "dv", "颤动感知": "ts", "盲视": "bs", "盲感": "bse", "灵敏嗅觉": "sc", "看破黑暗": "sid", "识破隐形": "si", "昏暗视觉": "ll"}
FLY = {"完美": "perfect", "极佳": "perfect", "优良": "good", "良好": "good", "普通": "average", "一般": "average", "不良": "poor",
       "笨拙": "clumsy"}
ENERGY = {"酸蚀": "acid", "酸": "acid", "寒冷": "cold", "冰冷": "cold", "电击": "electric", "闪电": "electric", "火焰": "fire",
          "音波": "sonic", "声波": "sonic"}
DR_TYPE = {"魔法": "magic", "寒铁": "coldIron", "秘银": "silver", "银": "silver", "精金": "adamantine", "善良": "good", "邪恶": "evil",
           "守序": "lawful", "混乱": "chaotic", "钝击": "bludgeoning", "穿刺": "piercing", "挥砍": "slashing", "史诗": "epic"}


def num(s, default=None):
    m = re.search(r"[+\-–−]?\d+", (s or "").replace(",", ""))
    if not m:
        return default
    return int(m.group(0).replace("–", "-").replace("−", "-"))


def links_to_names(s):
    """「[[飞越攻击|跃击]]」→ 返回 (显示文字, 维基目标)。"""
    return re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", re.sub(r"\[\[([^\]|]+)\]\]", r"\1", s or ""))


def split_top(s, seps="，,;；"):
    """按顶层分隔符切（括号里的不切）。"""
    out, buf, depth = [], "", 0
    for ch in s or "":
        if ch in "（(【[":
            depth += 1
        elif ch in "）)】]":
            depth = max(0, depth - 1)
        if ch in seps and depth == 0:
            if buf.strip():
                out.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        out.append(buf.strip())
    return out


# 属性块用词和通用规则词条名不一样的
ABIL_ALIAS = {"凶威": "气势凶猛", "恐惧灵氲": "恐惧", "撕裂": "撕扯"}
ALIAS = {"顺劈斩": "顺势斩", "高等双武器攻击": "高等双武器格斗", "精通双武器攻击": "精通双武器格斗", "灵活机动": "灵活移动",
         "二刀斩": "双武器撕裂", "强化强韧": "精通强韧加强",
         "致命攻击": "要害打击", "强化坚韧": "精通强韧加强", "高等坚韧": "强韧加强", "突进": "突刺",
         "剑刃障壁": "剑刃护壁", "侦测守序": "侦测秩序", "看破隐形": "识破隐形", "治疗严重伤": "治疗重伤", "群体治疗严重伤": "群体治疗重伤",
         "治疗中等伤害": "治疗中伤", "造成严重伤害": "造成重伤", "幽深黑暗术": "深幽黑暗术", "高级传送术": "高等传送术",
         "近程射击": "近距射击", "防御战斗训练": "防御式战斗训练", "火焰盾": "火焰护盾", "寒冰射线": "冰冻射线", "暗示": "暗示术",
         "流血术": "流血"}
METAMAGIC = {"极效": "Maximize", "瞬发": "Quicken", "定发": "Quicken", "迅捷": "Quicken", "延时": "Extend", "扩展": "Extend",
             "强效": "Empower", "扩大": "Enlarge", "寂静": "Silent",
             "静止": "Still", "持久": "Persistent", "增高": "Heighten", "连锁": "Chain", "精准": "Disruptive"}


def lookup(group, text):
    """一项（可能带 [[链接]]）→ (uuid, 中文名, 参数)。参数是「武器专攻（啮咬）」里的「啮咬」。"""
    m = re.match(r"^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]\s*(.*)$", text)
    if m:
        target, label, rest = m.group(1).strip(), (m.group(2) or m.group(1)).strip(), m.group(3).strip()
        target = REDIR.get(target, target)
    else:
        target, label, rest = None, re.sub(r"[（(].*$", "", text).strip(), re.sub(r"^[^（(]*", "", text).strip()
    param = None
    pm = re.match(r"^[（(](.+?)[）)]", rest)
    if pm:
        param = links_to_names(pm.group(1))
    g = G[group]
    keys = [target, label] if target else [label]
    keys += [ALIAS.get(label)] if ALIAS.get(label) else []
    fa = ALIASF.get(group, {}).get(label)
    if fa and re.search(r"[一-鿿]", fa):
        keys.append(fa)
    elif fa:
        for k in name_variants(fa):
            if k in G[group]["en"]:
                return G[group]["en"][k], label, param
    if group == "spell":
        keys += [label + "术", label[:-1] if label.endswith("术") else None]
    # 回退：去掉「 4 级」「 D」「*」之类尾巴；夹着英文的直接用英文查；旧译名用 CHM 中英对照转成英文再查
    bare = re.sub(r"\s*(\d+\s*级|\bD\b|\*+)\s*$", "", re.sub(r"[A-Za-z][A-Za-z '\-]*$", "", label)).strip()
    if bare and bare != label:
        keys.append(bare)
    latin = re.search(r"[A-Za-z][A-Za-z '\-]{3,}", text)
    for key in keys:
        if not key:
            continue
        if key in g["zh"]:
            return g["zh"][key], label, param
        en = TITLE_EN.get(key)
        if en:
            for k in name_variants(en):
                if k in g["en"]:
                    return g["en"][k], label, param
    for en in [latin.group(0).strip() if latin else None] + [extras.chm_en(k) for k in keys if k]:
        if en:
            for k in name_variants(en):
                if k in g["en"]:
                    return g["en"][k], bare or label, param
    return None, label, param


def parse_hp(s):
    m = re.match(r"\s*(\d+)\s*[（(]\s*(\d+)\s*d\s*(\d+)", (s or "").replace(" ", ""), re.I)
    regen = re.search(r"再生\s*(\d+)(?:[（(]([^）)]+)[）)])?", s or "")
    fh = re.search(r"快速治疗\s*(\d+)", s or "")
    if not m:
        # 「183（15 HD；4d10+11d10+101）」：写了 HD 数、骰子有好几种
        ss = re.sub(r"<!--.*?-->", "", s or "")
        tot = re.match(r"\s*(\d+)", ss)
        hdn = re.search(r"(\d+)\s*HD", ss, re.I)
        dice = re.findall(r"(\d+)\s*d\s*(\d+)", ss, re.I)
        if tot and (hdn or dice):
            hd = int(hdn.group(1)) if hdn else sum(int(n) for n, _ in dice)
            return {"total": int(tot.group(1)), "hd": hd, "die": int(dice[0][1]) if dice else 8}, \
                (f"{regen.group(1)}（{regen.group(2)}）" if regen and regen.group(2) else (regen.group(1) if regen else "")), \
                (fh.group(1) if fh else "")
    return {"total": int(m.group(1)), "hd": int(m.group(2)), "die": int(m.group(3))} if m else {"total": num(s)}, \
        (f"{regen.group(1)}（{regen.group(2)}）" if regen and regen.group(2) else (regen.group(1) if regen else "")), \
        (fh.group(1) if fh else "")


def parse_ac(s):
    tot = num(s)
    touch = re.search(r"接触\s*(\d+)", s or "")
    ff = re.search(r"措手不及\s*(\d+)", s or "")
    nat = re.search(r"\+\s*(\d+)\s*天生", s or "")
    return {"normal": tot, "touch": int(touch.group(1)) if touch else None, "ff": int(ff.group(1)) if ff else None,
            "natural": int(nat.group(1)) if nat else 0}


def parse_speed(s):
    sp = {"land": None}
    for part in split_top(s):
        n = num(part)
        if n is None:
            continue
        if "飞行" in part:
            man = next((v for k, v in FLY.items() if k in part), "average")
            sp["fly"] = {"base": n, "maneuverability": man}
        elif "游泳" in part:
            sp["swim"] = n
        elif "攀爬" in part:
            sp["climb"] = n
        elif "掘" in part:
            sp["burrow"] = n
        elif sp["land"] is None:
            sp["land"] = n
    return sp


def parse_attacks(s, kind):
    """「啮咬 +20（2d6 +10/19–20），2 爪抓 +19（1d8 +7）」→ 列表。「或」分开的是另一套全攻击。"""
    out = []
    if not s:
        return out
    for alt_i, alt in enumerate(re.split(r"\s*或者?\s*", links_to_names(s))):
        for part in split_top(alt):
            m = re.match(r"^(?:(\d+)\s*)?(.+?)\s*((?:[+\-–]\d+\s*/?\s*)+)\s*[（(](.+)[）)]\s*$", part)  # 「+21/ +21/ +16」斜杠后带空格
            if not m:
                continue
            cnt, name, bonuses, inner = m.groups()
            bon = [int(b.replace("–", "-")) for b in re.findall(r"[+\-–]\d+", bonuses)]
            dm = re.match(r"^\s*(\d+d\d+|\d+)\s*([+\-–]\s*\d+)?\s*(?:/\s*(\d+)\s*[–\-]\s*20)?\s*(?:/\s*[x×](\d))?\s*(.*)$", inner.replace(" ", " "))
            dice, dbon, crit_lo, mult, extra = (dm.groups() if dm else (None, None, None, None, inner))
            name = re.sub(r"\s*[A-Za-z][A-Za-z ,'\-]*$", "", name.strip()).strip()  # 「啮咬 bite」后面的英文去掉
            name = re.sub(r"\s*[（(][A-Za-z ,'\-]+[）)]$", "", name).strip()  # 「啮咬（bite）」
            flurry = bool(re.search(r"疾风连击", name))
            name = re.sub(r"疾风连击", "", name).strip() or name  # 「疾风连击 +1 徒手攻击」：武器照常，备注疾风连击
            pm = re.search(r"\s*\+(\d)\s*", name)
            core = re.sub(r"\s*\+\d\s*", "", name).strip() if pm else name
            fa = ALIASF.get("attack", {}).get(core)
            nat, supp = None, None
            if fa and fa.startswith("NAT:"):
                nat = fa[4:]  # 指向天生攻击：名字照属性块
            elif fa and fa.startswith("SUPP:"):
                supp, nat = fa[5:], "supp"  # 补充合集包里的攻击（尾扫、投石、接触……），按天生攻击算主次
            elif fa:
                name = (f"+{pm.group(1)}" if pm else "") + fa
            name = GEAR_ALIAS.get(name, name)
            for k, v in ({} if nat else NATURAL).items():
                if name == k or name.endswith(k):
                    nat = v
                    break
            out.append({"kind": kind, "set": alt_i, "count": int(cnt or 1), "name": name, "bonus": bon, "natural": nat, "supp": supp,
                        "dice": dice, "dmgBonus": int(dbon.replace(" ", "").replace("–", "-")) if dbon else 0,
                        "critRange": int(crit_lo) if crit_lo else 20, "critMult": int(mult) if mult else 2,
                        "extra": ((extra or "").strip("，, ") + ("（疾风连击）" if flurry else "")).strip()})
    return out


def parse_skills(s):
    out = []
    for part in split_top(s):
        txt = links_to_names(part)
        m = re.match(r"^(.+?)\s*[（(]([^）)]+)[）)]\s*([+\-–]\d+)", txt) or re.match(r"^(.+?)\s*()([+\-–]\d+)", txt)
        if not m:
            continue
        base, sub, val = m.group(1).strip(), m.group(2), int(m.group(3).replace("–", "-"))
        if base == "知识":
            key = KNOW.get(sub)
            if key:
                out.append({"key": key, "total": val})
            continue
        key = SKILL.get(base)
        if key in ("crf", "prf", "pro"):
            out.append({"key": key, "sub": sub or base, "total": val})
        elif key:
            out.append({"key": key, "total": val})
    return out


CLASS_ALIAS = {"死灵师": "法师", "塑能师": "法师", "咒法师": "法师", "幻术师": "法师", "惑控师": "法师", "预言师": "法师",
               "防护师": "法师", "变化师": "法师", "变形师": "法师", "盗贼": "游荡者", "圣武士": "圣骑士", "反圣武士": "反圣骑士",
               "骑士": "骑将", "枪手": "铳士", "剑客": "游荡剑客", "炼金术士": "炼金术师"}
KNOWN = set()  # 种族名 + 维基上所有生物名，main() 里填
FEAT_EN_OF = {}  # 专长 uuid → 英文名键（第一个）
for _k, _u in G["feat"]["en"].items():
    FEAT_EN_OF.setdefault(_u, _k)


def race_ok(r):
    """职业前面那段是不是种族/生物名（可以带「拉玛什图的」这种信仰、性别年龄词）。"""
    r = re.sub(r"^(男性|女性|雄性|雌性|男|女)?(年轻|青年|中年|老年|暮年|年迈|年长)?", "", r)
    return not r or r in KNOWN or any(r.startswith(k) for k in KNOWN if len(k) >= 2 and len(k) < len(r))


def class_split(name):
    """「食人魔战士」→ 战士（不是魔战士）、「人类炼金术士」→ 炼金术师（不是术士）：
    职业名取能对上合集包的后缀；有几种切法时，选前面那段是已知种族/生物名的，都不是就取最长的职业名。"""
    hits = []
    for i in range(min(6, len(name)), 1, -1):
        cand = CLASS_ALIAS.get(name[-i:], name[-i:])
        u = G["class"]["zh"].get(cand)
        if u:
            hits.append((u, i))
    if not hits:
        return None, 0
    for u, i in hits:
        if race_ok(name[:len(name) - i]):
            return u, i
    return hits[0]


def clean_race(t):
    """职业前的描述词 → 种族名：去掉性别、年龄、「X的」（信仰）、空格和括注。"""
    t = re.sub(r"[（(].*?[）)]", "", t or "")
    t = re.sub(r"^种族[：:]\s*", "", t)
    t = re.sub(r"[，,]?\s*职业[：:]?\s*$", "", t)
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"^(男性|女性|雄性|雌性|男|女)", "", t)
    t = re.sub(r"^(年轻|青年|中年|老年|暮年|年迈|年长|古稀)", "", t)
    known = max((k for k in KNOWN if len(k) >= 2 and t.startswith(k)), key=len, default="")
    if known:  # 「豺狼人拉玛什图的」「人类艾奥梅黛」→ 开头最长的已知种族/生物名
        return known
    t = re.sub(r"[一-鿿]{1,5}的$", "", t)
    return t if len(t) >= 2 else ""


def skill_specs(param):
    """「察觉」「知识（宗教）」「手艺（炼金）」「隐匿、察觉」→ [{key, sub?}]。"""
    out = []
    alias = {"专业": "职业", "杂技": "特技", "骑乘": "骑术", "感知": "察觉", "手上功夫": "巧手", "隐秘": "隐匿", "伪装": "易容", "造物": "手艺"}
    for part in re.split(r"[，,、/]", param):
        part = re.sub(r"[〔［\[【]", "（", re.sub(r"[〕］\]】]", "）", part.strip()))
        for k, v in alias.items():
            part = re.sub("^" + k, v, part)
        part = re.sub(r"^(职业|手艺|表演|知识)\s*[-－—]\s*(.+)$", lambda m: f"{m.group(1)}（{m.group(2)}）", part)  # 「专业-矿工」
        m = re.match(r"^(.+?)\s*[（(：:]\s*([^）)]+?)\s*[）)]?$", part)
        base, sub = (m.group(1).strip(), m.group(2).strip()) if m else (part, "")
        if base == "知识":
            if KNOW.get(sub):
                out.append({"key": KNOW[sub]})
            continue
        key = SKILL.get(base)
        if key in ("crf", "prf", "pro"):
            out.append({"key": key, "sub": sub or base})
        elif key:
            out.append({"key": key})
    return out


def parse_spells(s, sla=False):
    """类法术能力/法术 → {cl, concentration, kind, groups:[{freq|level, perDay, spells:[{uuid,name,dc,count,note}]}]}。"""
    if not s:
        return None
    s = re.sub(r"<br\s*/?>", "；", s.replace("\n", ""))  # 两段之间的换行（类法术能力 <br> 异能魔法）
    # 施法者等级的写法：施法者等级 6 / CL 6 / CL6 / CL 18 级 / 19级施法者；可能在括号里，也可能是开头几段
    cfg_re = r"施法者等级|(?i:CL)\s*[=＝]?\s*\d|\d+\s*级\s*施法者|专注"
    title, cfg, body = "", "", s
    head = re.match(r"^(.*?)[（(]([^（）()]*(?:" + cfg_re + r")[^（）()]*)[）)]\s*[；;:：]?\s*(.*)$", s)
    if head and re.search(r"[—–；;]", head.group(1)):
        head = None  # 括号在某条法术里（「死者交谈（6个问题，CL 12级）」），不是开头的施法者等级
    if head:
        title, cfg, body = head.groups()
    else:
        parts = split_top(s, "；;")
        k = 0
        while k < len(parts) and re.search(cfg_re, parts[k]) and not re.search(r"[—–]", parts[k]):
            k += 1
        if k:
            cfg, body = "；".join(parts[:k]), "；".join(parts[k:])
    mcl = re.search(r"(?:施法者等级|(?i:CL))\s*[=＝]?\s*(\d+)|(\d+)\s*级\s*施法者", cfg)
    cl = int(mcl.group(1) or mcl.group(2)) if mcl else None
    conc = re.search(r"专注\s*([+\-–])\s*(\d+)", cfg)
    res = {"cl": cl, "concentration": (int(conc.group(2)) * (-1 if conc.group(1) in "-–" else 1)) if conc else None,
           "title": title.strip("；; "), "prepared": "已准备" in title or "准备" in title, "groups": []}
    # 每组：「3次/天—连锁闪电」「随意-枯朽术」「1次/天：枯萎术」「4级（每天4次）破除结界」「2环——树肤术」
    label_re = (r"^\s*((?:\d+\s*(?:级|环)(?:\s*[（(][^（）()]*[）)])?)|随意使用|任意使用|随意|常驻|恒定|"
                r"(?:每日|每天)\s*\d+\s*次|\d+\s*次?\s*/\s*(?:天|日)|每(?:周|月|年)\s*\d+\s*次|\d+\s*次?\s*/\s*(?:周|月|年))"
                r"(?:\s*[（(][^（）()]*[）)])?\s*[—–\-:：]*\s*(.+)$")
    for grp in split_top(body, "；;"):
        grp = grp.strip()
        hb = re.match(r"^([^—–；;]*?[（(][^（）()]*(?:" + cfg_re + r")[^（）()]*[）)])\s*(.*)$", grp)
        if hb:  # 第二个法术书的标题和第一组连在一起（「异能魔法（施法者等级 10；专注 +14）24 PE—思维预读……」）：去掉标题，后面照常
            res.setdefault("extraBooks", []).append(hb.group(1))
            grp = hb.group(2).strip()
            if not grp:
                continue
        dash = re.match(r"^\s*([^—–]{1,24}?)\s*[—–]+\s*(.+)$", grp)  # 「随意施放—」「领域类法术能力……」先按破折号切
        gm = dash or re.match(label_re, grp)
        if not gm:
            if re.search(cfg_re, grp):
                res.setdefault("extraBooks", []).append(grp)  # 第二个法术书的标题（异能魔法、游侠法术之后的术士法术）：后面的法术并进同一本
            continue
        label, items = gm.groups()
        g = {"label": label.strip()}
        lv = re.match(r"^(\d+)\s*(?:级|环)", label)
        if lv:
            g["level"] = int(lv.group(1))
        pd = re.search(r"(\d+)\s*次?\s*/\s*(?:天|日)|(?:每日|每天)\s*(\d+)\s*次", grp[:len(label) + 12])
        if pd:
            g["perDay"] = int(next(x for x in pd.groups() if x))
        if re.search(r"随意|任意使用", label):
            g["atWill"] = True
        if re.search(r"恒定|常驻|永久", label):
            g["constant"] = True
        g["spells"] = []
        for it in split_top(items, "，,"):
            cnt = re.search(r"[xX×]\s*(\d+)", it)
            dc = re.search(r"DC\s*(\d+)", it)
            clean = re.sub(r"\s*[xX×]\s*\d+", "", it).strip()
            clean = re.sub(r"^(以下之一[：:])", "", clean)
            clean = re.sub(r"(?:\s*(?:UC|APG|ARG|ACG|UM|UE|OA|UI|ISWG|ISM|M|\d*PE))+(?=\s*(?:[（(]|$))", "", clean).strip(" 。.")
            if re.match(r"^(另外|其他|\d+\s*其他|\d+）|空槽|M：)", clean) or len(re.findall(r"[一-鿿]", clean)) < 2:
                continue
            uuid, label2, param = lookup("spell", clean)
            meta = summon = None
            # 魔类的「召唤（等级 3，1 暴怖魔 50%）」：通用规则「召唤」，按对应环级的召唤怪物法术处理
            sm = re.match(r"^(?:召唤|召唤恶魔|恶魔召唤|召唤魔鬼|召唤邪魔|召唤天使)\s*[（(]\s*(?:等级\s*)?(\d)\s*(?:级|级法术|环)?\s*[，,；;]\s*(.+?)\s*[）)]$", links_to_names(clean))
            if sm:
                roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][int(sm.group(1))]
                uuid, _, _ = lookup("spell", f"召唤怪物 {roman}")
                label2, param = "召唤", None
                summon = {"level": int(sm.group(1)), "detail": sm.group(2), "uuid": G["ability"]["zh"].get("召唤")}
            if not uuid:
                for zh_m, en_m in METAMAGIC.items():
                    if links_to_names(clean).startswith(zh_m):
                        uuid, label2, param = lookup("spell", links_to_names(clean)[len(zh_m):])
                        meta = zh_m
                        break
            elif not meta:
                # 旧译名对照直接把「瞬发XX」对到了基础法术：超魔前缀照样记下（物品名要带上）
                meta = next((zh_m for zh_m in METAMAGIC if links_to_names(clean).startswith(zh_m)), None)
            feat_uuid = None
            if not uuid:  # 领域能力、学派能力之类写在法术栏里的（秩序之触、魅惑微笑）
                feat_uuid = G["classfeat"]["zh"].get(re.sub(r"[（(].*$", "", links_to_names(clean)).strip())
            g["spells"].append({"uuid": uuid, "featUuid": feat_uuid, "name": links_to_names(label2), "dc": int(dc.group(1)) if dc else None,
                                "count": int(cnt.group(1)) if cnt else 1,
                                "note": param if param and "DC" not in param else None, "meta": meta, "summon": summon,
                                "raw": links_to_names(it)})
        res["groups"].append(g)
    return res


def special_abilities(raw):
    out = []
    for m in re.finditer(r"\{\{怪物能力\|([^|]*)\|([^|]*)\|(.*?)\}\}", raw or "", re.S):
        out.append({"name": m.group(1).strip(), "type": m.group(2).strip(), "text": m.group(3).strip()})
    return out


GEAR_ALIAS = {"镶嵌革甲": "镶嵌皮甲", "兽皮甲": "革甲", "生皮甲": "革甲", "轻木盾牌": "轻木盾", "重木盾牌": "重木盾", "巨型棒": "巨棒",
              "链枷": "轻型链枷", "重镐": "重型镐", "漂浮靴": "浮空靴", "徒手攻击": "徒手打击", "长棍": "木棍", "箭": "箭矢"}
# 名字里的旧译词（后面常带 +N）
GEAR_WORDS = [("抗力斗篷", "抗力披风"), ("魅力头环", "魅力头带")]


CONS = [("药水", "potion"), ("药剂", "potion"), ("油", "potion"), ("卷轴", "scroll"), ("魔杖", "wand")]


def consumable(nm, inner, qty, raw):
    """「治疗中伤药水」「治疗轻伤魔杖（CL 1，20 发）」「魔化武器油」→ 消耗品计划（建造时由法术生成）。"""
    m = re.match(r"^(?:(.+?)(药水|药剂|之油|油|卷轴|魔杖)|(药水|卷轴|魔杖|油)[：:](.+))$", nm)
    if not m:
        return None
    core, kind = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
    kind = {"之油": "油"}.get(kind, kind)
    uuid, _, _ = lookup("spell", core.strip())
    if not uuid:
        return None
    cl = re.search(r"(?:CL|施法者等级)\s*(\d+)", inner or "")
    ch = re.search(r"(\d+)\s*(?:发|次|charges)", inner or "")
    typ, cl = dict(CONS)[kind], int(cl.group(1)) if cl else None
    key = f"cons:{typ}:{uuid}:{cl or 0}"
    return {"consumable": typ, "spell": uuid, "cl": cl, "key": key, "uuid": supp_uuid(key),
            "charges": int(ch.group(1)) if ch else None, "qty": qty, "zh": nm, "raw": raw}


def gear_list(r):
    """gear、combat_gear、宝藏栏「NPC 装备（皮甲，轻木盾，短剑……）」→ [{zh, qty, raw}]。"""
    parts = []
    for fld in ("gear", "combat_gear"):
        parts += split_top(links_to_names(r.get(fld) or ""), ";；，,")
    m = re.search(r"(?:NPC\s*装备|标准|双倍|三倍|附带)\s*[（(](.+)[）)]", links_to_names(r.get("treasure") or ""))
    if m:
        parts += split_top(re.sub(r"(以及|和|与)", "，", m.group(1)), "，,")
    parts = [x for p in parts for x in split_top(re.sub(r"(以及|与)", "，", p), "，,")]
    # 「轻弩和20发弩矢」「短弓附20支箭」：两件东西写在一起
    parts = [x for p in parts for x in re.split(r"(?:和|及|附|带|外加)(?=\s*\d)", p) if x.strip()]
    # 只用空格隔开的整行（「精制品重十字镐 精制品手里剑 x50 +2巨人力量腰带 +1防御护腕 141gp」）：按空格拆，「x50」并回前一件
    sp = []
    for p in parts:
        toks = p.split()
        if len(toks) >= 3 and re.fullmatch(r"[\d,]+\s*(?:gp|GP|金币|sp|cp|pp)", toks[-1]):
            for t in toks:
                if re.fullmatch(r"[xX×]\s*\d+", t) and sp:
                    sp[-1] += " " + t
                else:
                    sp.append(t)
        else:
            sp.append(p)
    parts = sp
    out = []
    for p in parts:
        p = p.strip()
        cm = re.match(r"^([\d,]+)\s*(gp|GP|金币|金|sp|SP|银币|cp|CP|铜币|pp|PP|白金币)$", p)
        if cm:
            out.append({"currency": {"gp": "gp", "金币": "gp", "金": "gp", "sp": "sp", "银币": "sp", "cp": "cp", "铜币": "cp", "pp": "pp",
                                     "白金币": "pp"}[cm.group(2).lower() if cm.group(2).isascii() else cm.group(2)],
                        "qty": int(cm.group(1).replace(",", "")), "raw": p})
            continue
        q = re.match(r"^(\d+)\s*(?:支|只|个|瓶|根|枚|件|把|剂|份|卷|袋|罐|发|颗|粒|条|张|套|对|本|包|块|片)?\s*(.+)$", p)
        qty, nm = (int(q.group(1)), q.group(2)) if q else (1, p)
        xm = re.search(r"\s*[xX×]\s*(\d+)\s*$", nm)
        if xm:
            qty, nm = int(xm.group(1)), nm[:xm.start()]
        inner = re.search(r"[（(](.*)[）)]", nm)
        nm = re.sub(r"[（(].*$", "", nm).strip()
        pm = re.search(r"\s*\+(\d)\s*", nm)
        core = re.sub(r"\s*\+\d\s*", "", nm).strip() if pm else nm
        if ALIASF.get("gear", {}).get(core):
            al = ALIASF["gear"][core]
            if pm and re.search(r"[+＋]\s*\d", al):
                # 对照名自己带加值（防御护腕 → 防御护腕 +1）：换成属性块的加值，不能再在前面加一个（原来成了「+3防御护腕 +1」，拿到的是 +1 那件）
                nm = re.sub(r"[+＋]\s*\d", f"+{pm.group(1)}", al, count=1)
            else:
                nm = (f"+{pm.group(1)}" if pm else "") + al
        nm = GEAR_ALIAS.get(nm, nm)
        con = consumable(nm, inner.group(1) if inner else "", qty, p)
        if con:
            out.append(con)
            continue
        for a, b in GEAR_WORDS:
            nm = nm.replace(a, b)
        if nm and not re.search(r"其他|财宝|宝藏", nm):
            out.append({"zh": nm, "qty": qty, "raw": p})
    return out


def plan_for(e):
    r = e["raw"]
    hp, regen, fh = parse_hp(r.get("hp"))
    typ = r.get("type", "").strip()
    rhd_uuid = G["racialhd"]["en"].get(norm(TYPE_EN.get(typ, "")))
    classes = []
    race_hint = ""
    eff_level = 0
    cl_line = links_to_names(r.get("classline") or "")
    cl_line = re.sub(r"等级\s*(?=\d)", "", cl_line)  # 「德鲁伊等级5」
    cl_line = re.sub(r"[（(][^（）()]*[）)]\s*(?=\d)", "", cl_line)  # 「牧师（诺格巴）1」：信仰写在职业和等级中间
    cl_line = re.sub(r"\s*\b(?:UC|APG|ACG|UM|OA|ARG|UI|ISWG|UW)\s*(?=\d)", "", cl_line)  # 「魔战士 UM9」
    for m in re.finditer(r"([\u4e00-\u9fff]+?)\s*(\d+)(?:\s*级)?(?=\s|$|，|/|[（(；;,、])|(\d+)\s*级\s*[\u4e00-\u9fff]*?([\u4e00-\u9fff]{2})(?=$|\s)", cl_line):
        name, lvl = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        if name.endswith("大法师") or name.startswith("有效") or "有效" in cl_line[max(0, m.start() - 2):m.start()]:
            # 神话道途「大法师 6」（Archmage）是神话阶级；「有效德鲁伊等级」是动物伙伴的折算等级：都不是职业等级
            if "有效" in name or "有效" in cl_line[max(0, m.start() - 2):m.start()]:
                eff_level = int(lvl)
            continue
        uuid, i = class_split(name)
        if uuid:
            classes.append({"uuid": uuid, "name": name, "level": int(lvl)})
            if len(classes) == 1:  # 第一个职业前面的字是种族：「巨魔战士3」「人类 战士 4」「男性沼泽巨人大衮的牧师 10」
                race_hint = (cl_line[:m.start()] + name[:len(name) - i]).strip()
    class_levels = sum(c["level"] for c in classes)
    racial_hd = max(0, (hp.get("hd") or (eff_level if not classes else 0)) - class_levels)  # 魔宠的 HP 行不写 HD：生命骰数 = 主人等级
    # 类人生物带职业时，种族生命骰 = 总 HD − 职业等级（普通种族正好是 0；战蜥人这类有 2 个种族生命骰）
    feats, missing = [], []
    feat_parts = []
    for f in split_top(r.get("feats"), ";；，,"):
        # 只用空格隔开的整行（武僧类 NPC：「致命瞄准 拨挡飞箭 闪避 精通徒手攻击」）
        toks = f.split()
        feat_parts += toks if len(toks) >= 3 and not re.search(r"[（(\[]", f) else [f]
    for f in feat_parts:
        # 神话专长：属性块写「精通先攻 M」「强韧加强 M」；合集包里是「Improved Initiative (Mythic)」（中文名和普通版一样）
        mythic = bool(re.search(r"(?:^|[\s\]）)])M\s*$|ᴹ\s*$", links_to_names(f)))
        ff = re.sub(r"\s*(?:M|ᴹ)\s*$", "", f) if mythic else f
        if re.match(r"^\s*(?:\[\[)?神话", ff) and not lookup("feat", ff)[0]:
            mythic, ff = True, re.sub(r"神话", "", ff, count=1)  # 「神话猛力攻击」：前缀写法
        uuid, label, param = lookup("feat", ff)
        if mythic and uuid:
            en = FEAT_EN_OF.get(uuid)
            mu = G["feat"]["en"].get(f"{en} mythic") if en else None
            if mu:
                uuid = mu
            else:
                mythic = "没有神话版"  # 只有普通版的（或神话专长本身就叫这个名字）
        rec = {"uuid": uuid, "name": label, "param": param, "raw": links_to_names(f)}
        if mythic:
            rec["mythic"] = mythic
        if uuid and param and (label or "").startswith("技能专攻"):
            rec["skills"] = skill_specs(param)  # 技能专攻（察觉）→ 给察觉 +3（10 级起 +6）
        (feats if uuid else missing).append(rec)
    abilities = {}
    for k in ("str", "dex", "con", "int", "wis", "cha"):
        v = (r.get(k) or "").strip()
        abilities[k] = None if v in ("–", "-", "—", "") else num(v)
    senses, senses_custom = {}, []
    for part in split_top(re.split(r"[；;]", r.get("senses") or "")[0]):
        p = links_to_names(part)
        hit = False
        for k, key in SENSE.items():
            if p.startswith(k):
                senses[key] = num(p, 0) if key not in ("ll", "sid", "si") else True
                hit = True
        if not hit and p.strip() and not p.startswith("察觉"):
            senses_custom.append(p.strip().strip("*"))
    senses["custom"] = "，".join(senses_custom)
    sa_text = special_abilities(r.get("special_abilities"))
    named = []  # 特殊攻击/防御/特质里提到的能力名（全文可能在 special_abilities 里）
    for fld in ("special_attacks", "defensive", "sq", "aura"):
        for part in split_top(r.get(fld) or "", ";；，,"):
            nm = re.sub(r"[（(].*$", "", links_to_names(part)).strip().strip("*")
            nm = re.sub(r"\s*[+\-–]?\d+.*$", "", nm).strip()
            if nm and not re.match(r"^\d", nm):
                named.append({"name": nm, "field": fld, "raw": part})
    abil_items = []
    seen = set()
    page_ab = extras.page_abilities(E_ALL, special_abilities)
    tpl = {}
    for k in (r["english_name"], e["title"].split("(")[0]):
        tpl.update(page_ab.get("模板:" + k, {}))
    sib = {**tpl, **page_ab.get(r.get("family") or "", {}), **page_ab.get(e["title"], {})}
    for a in sa_text + named:
        nm = a["name"]
        if nm in seen:
            continue
        seen.add(nm)
        if not any(x["name"] == nm for x in sa_text):
            # 同页其他属性块或怪物绪论里的全文；属性块里常写简称（「寒冷」→「寒冷灵氲」），按前缀找唯一的那个
            key = nm if nm in sib else next(iter([k for k in sib if k.startswith(nm)] if len([k for k in sib if k.startswith(nm)]) == 1 else []), None)
            if key:
                sa_text.append({**sib[key], "name": nm, "full": key})
        uuid, _, _ = lookup("ability", a.get("raw") if "[[" in (a.get("raw") or "") and "通用怪物规则" not in (a.get("raw") or "") else nm)
        if not uuid:
            uuid, _, _ = lookup("ability", ABIL_ALIAS.get(nm, nm))
        if not uuid and nm.endswith("凝视"):
            uuid, _, _ = lookup("ability", "凝视")  # 石化凝视等：挂通用规则「凝视」，具体效果写在前面
        if not uuid and nm not in sib:
            uuid, _, _ = lookup("classfeat", nm)  # 职业能力（死灵学派的墓穴之触等）
        if not uuid and nm not in sib:
            uuid = G["racialtrait"]["zh"].get(nm)  # 种族特性（防御训练、兽人凶猛……）
        if not uuid and (ALIASF.get("ability", {}).get(nm) or "").startswith("SUPP:"):
            uuid = ALIASF["ability"][nm][5:]
        if not uuid and ALIASF.get("ability", {}).get(nm):
            fa = ALIASF["ability"][nm]
            for grp in ("ability", "classfeat", "racialtrait", "feat"):
                uuid = G[grp]["zh"].get(fa) or next((G[grp]["en"][k] for k in name_variants(fa) if k in G[grp]["en"]), None)
                if uuid:
                    break
        if not uuid and extras.chm_en(nm):  # 凶威 → Frightful Presence
            for k in name_variants(extras.chm_en(nm)):
                uuid = G["ability"]["en"].get(k)
                if uuid:
                    break
        full = next((x for x in sa_text if x["name"] == nm), None)
        raw_line = links_to_names(a.get("raw", ""))
        text = w2h(full["text"]) if full else ""
        if not text and raw_line:
            # 没有专门的全文：放属性块里那一行（对上通用规则的，搭建时再接上规则说明）
            text = f"<p>{raw_line}</p>"
        abil_items.append({"name": (full or {}).get("full") or nm, "type": (full or {}).get("type", ""), "uuid": uuid, "text": text, "raw": raw_line,
                           "img": None if uuid else extras.pick_icon(nm, re.sub(r"<[^>]+>", "", text)),
                           "params": extras.action_params(raw_line if raw_line != nm else "", text, (full or {}).get("full") or nm)})
    # 怪物特性（不死特性、泥怪特性……）
    for part in split_top(links_to_names(r.get("immune") or ""), ";；，,"):
        if "特性" in part:
            uuid, _, _ = lookup("ability", part)
            if uuid and part not in seen:
                abil_items.append({"name": part, "type": "", "uuid": uuid, "text": "", "raw": part, "img": None})
                seen.add(part)
    lore = "\n\n".join(x for x in (r.get("description"), r.get("lore")) if x)
    return {
        "en": r["english_name"], "zh": re.sub(r"\(.*?\)$", "", r.get("name") or e["title"]), "name": r.get("name") or e["title"], "ai": e.get("ai", False),
        "cr": r.get("cr"), "alignment": ALIGN.get(r.get("alignment", "").strip()), "size": SIZE.get(r.get("size", "").strip(), "med"),
        "type": typ, "subtypes": r.get("subtypes", ""), "classLine": cl_line, "raceHint": clean_race(race_hint), "racialHD": {"uuid": rhd_uuid, "level": racial_hd} if rhd_uuid and racial_hd else None,
        "classes": classes, "hp": hp, "regen": regen, "fastHealing": fh, "ac": parse_ac(r.get("ac")),
        "saves": {k: num(r.get(k)) for k in ("fort", "ref", "will")}, "init": num(r.get("init")), "bab": num(r.get("bab")),
        "cmb": num(r.get("cmb")), "cmd": num(r.get("cmd")), "abilities": abilities, "speed": parse_speed(r.get("speed")),
        "senses": senses, "sensesRaw": links_to_names(r.get("senses")), "space": r.get("space"), "reach": links_to_names(r.get("reach") or ""),
        "attacks": parse_attacks(r.get("melee"), "melee") + parse_attacks(r.get("ranged"), "ranged"),
        "feats": feats, "featsMissing": missing, "skills": parse_skills(r.get("skills")),
        "racialMods": links_to_names(r.get("racial_mods") or ""), "languages": links_to_names(r.get("languages") or ""),
        "sla": parse_spells(r.get("spell_like"), sla=True), "spells": parse_spells(r.get("spells")),
        "abilitiesItems": abil_items, "defenses": extras.parse_defenses(r, split_top, links_to_names), "dr": r.get("dr") or "", "immune": links_to_names(r.get("immune") or ""),
        "resist": links_to_names(r.get("resist") or ""), "weak": links_to_names(r.get("weaknesses") or ""),
        "sr": num(r.get("sr")), "aura": links_to_names(r.get("aura") or ""), "specialAttacks": links_to_names(r.get("special_attacks") or ""),
        "sq": links_to_names(r.get("sq") or ""), "defensive": links_to_names(r.get("defensive") or ""),
        "gear": links_to_names(r.get("gear") or ""), "gearList": gear_list(r), "combatGear": links_to_names(r.get("combat_gear") or ""),
        "environment": r.get("environment"), "organization": r.get("organization"), "treasure": r.get("treasure"),
        "source": r.get("source"), "bio": w2h(lore),
    }


E_ALL = None


def main():
    global E_ALL
    E, *_ = pickle.loads(Path(r"E:/FoundryV13/zh-build/wiki_cache.pkl").read_bytes())
    E_ALL = E
    KNOWN.update(k for k in G["race"]["zh"] if re.search(r"[一-鿿]", k))
    KNOWN.update(e["raw"].get("name") or "" for e in E["creatures"])
    KNOWN.discard("")
    want = sys.argv[1:] or SAMPLES
    if want and want[0] == "--source":  # 按出处整本生成：python plan.py --source 怪物图鉴
        want = [e["raw"]["english_name"] for e in E["creatures"] if e["raw"].get("source") == want[1]]
    b1 = {}
    for e in E["creatures"]:
        en = e["raw"]["english_name"]
        if en in want and (en not in b1 or e["raw"].get("source") == "怪物图鉴"):
            b1[en] = e
    plans = [plan_for(b1[w]) for w in want if w in b1]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(plans, ensure_ascii=False, indent=1), encoding="utf8")
    for p in plans:
        miss_sp = sum(1 for b in (p["sla"], p["spells"]) if b for g in b["groups"] for s in g["spells"] if not s["uuid"])
        print(f'{p["en"]:22s} {p["zh"]:8s} HD{p["racialHD"]["level"] if p["racialHD"] else 0}+{[c["name"]+str(c["level"]) for c in p["classes"]]} '
              f'feats {len(p["feats"])}/{len(p["feats"])+len(p["featsMissing"])} atk {len(p["attacks"])} skills {len(p["skills"])} '
              f'abil {len(p["abilitiesItems"])}({sum(1 for a in p["abilitiesItems"] if a["uuid"])}) spellmiss {miss_sp} missFeat {[f["raw"] for f in p["featsMissing"]]}')


if __name__ == "__main__":
    main()
