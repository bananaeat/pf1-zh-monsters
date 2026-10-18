"""子代理的别名结果（aliases_out/*.json）→ plan.py 用的别名表（aliases/<组>.json）+ 补充合集包的攻击、能力（aliases/supplement_*.json）。

规则：
- 「t」= 候选里的中文名（必须是该组里真有的条目名）。能力类只收 high/mid 把握的（错配会带来错误的规则文字）；装备、攻击、专长、法术 low 也收。
- 「en」= 英文名：先在该组的英文索引里找；装备里的「Potion/Scroll/Wand of X」转成「X药水/卷轴/魔杖」交给消耗品逻辑；
  攻击、能力找不到的，进补充合集包（正文取维基：enindex 找到的卡片/小节/页面）。
- skip / 没有结论的不收。
python merge_aliases.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, r"E:/FoundryV13/zh-build/src")
ROOT = Path(r"E:/FoundryV13/monsters")
OUT = ROOT / "aliases"
IDX = json.loads((ROOT / "index.json").read_text(encoding="utf8"))
G = IDX["groups"]
from wiki import name_variants  # noqa: E402
from supp_ids import supp_uuid  # noqa: E402

GROUP_OF = {"feat": ["feat"], "spell": ["spell", "classfeat"], "gear": ["gear"], "attack": ["gear"],
            "ability_notext": ["ability", "classfeat", "racialtrait", "feat"]}
OUTFILE = {"feat": "feat", "spell": "spell", "gear": "gear", "attack": "attack", "ability_notext": "ability"}
CONS = {"potion": "药水", "scroll": "卷轴", "wand": "魔杖", "oil": "油", "elixir": "药剂"}


def en_uuid(groups, en):
    for g in groups:
        for k in name_variants(en):
            if k in G[g]["en"]:
                return G[g]["en"][k]
    return None


def zh_of_uuid(uuid):
    for g in G.values():
        for z, u in g["zh"].items():
            if u == uuid:
                return z
    return None


def wiki_text(en):
    """英文名 → (中文名, html)，取维基卡片/小节/页面。"""
    import fallback_render as fr
    return fr.render_en(en)


def main():
    OUT.mkdir(exist_ok=True)
    tables = {v: {} for v in OUTFILE.values()}
    supp_attack, supp_ability = {}, {}
    stats = {}
    zh_by_uuid = {}
    for g in G.values():
        for z, u in g["zh"].items():
            zh_by_uuid.setdefault(u, z)
    for f in sorted((ROOT / "aliases_out").glob("*.json")):
        cat = re.sub(r"_\d+$", "", f.stem)
        groups, table = GROUP_OF[cat], tables[OUTFILE[cat]]
        st = stats.setdefault(cat, {"t": 0, "en": 0, "supp": 0, "drop": 0})
        for term, v in json.loads(f.read_text(encoding="utf8")).items():
            if not isinstance(v, dict) or v.get("skip") and (not v.get("en") or cat == "ability_notext"):
                continue  # 能力里 skip 的（含给了英文名的类法术能力）一律不收
            conf = (v.get("c") or "mid").lower()
            t = v.get("t")
            if t and t.startswith("NAT:"):
                table[term] = t
                st["t"] += 1
                continue
            if t:
                if cat in ("ability_notext", "feat", "spell") and conf == "low":
                    st["drop"] += 1
                    continue
                if any(t in G[g]["zh"] for g in groups):
                    table[term] = t
                    st["t"] += 1
                    continue
            en = v.get("en")
            if not en or v.get("skip") and cat != "ability_notext":
                st["drop"] += 1
                continue
            if cat in ("ability_notext", "feat", "spell") and conf == "low":
                st["drop"] += 1
                continue
            u = en_uuid(groups, en)
            if u and zh_by_uuid.get(u):
                table[term] = zh_by_uuid[u]
                st["en"] += 1
                continue
            if u and cat in ("ability_notext", "attack"):
                table[term] = "SUPP:" + u  # 合集包里有、只是没有中文名：直接指向那一条
                st["en"] += 1
                continue
            if cat == "ability_notext" and en_uuid(["spell"], en):
                st["drop"] += 1  # 英文名是法术：是类法术能力，不当特殊能力
                continue
            if cat == "gear":
                m = re.match(r"^(Potion|Scroll|Wand|Oil|Elixir) of (.+)$", en, re.I)
                if m:
                    su = en_uuid(["spell"], m.group(2))
                    if su and zh_by_uuid.get(su):
                        table[term] = zh_by_uuid[su] + CONS[m.group(1).lower()]
                        st["en"] += 1
                        continue
                st["drop"] += 1
                continue
            if cat in ("feat", "spell"):
                st["drop"] += 1
                continue
            # 攻击、能力：进补充合集包
            zh_w, html = wiki_text(en)
            if cat == "attack":
                zh = v.get("zh") or term
                key = f"atk:{en.lower()}"
                e = supp_attack.setdefault(key, {"key": key, "kind": "attack", "name": f"{zh} ({en})", "en": en,
                                                 "description": html or "", "touch": bool(re.search(r"touch", en, re.I)),
                                                 "ranged": bool(re.search(r"rock|ray|projectile|spit|bomb|throw", en, re.I))})
                table[term] = "SUPP:" + supp_uuid(key)
                st["supp"] += 1
            else:
                if not html:
                    st["drop"] += 1
                    continue
                zh = zh_w or term
                key = f"abil:{en.lower()}"
                supp_ability.setdefault(key, {"key": key, "kind": "ability", "name": f"{zh} ({en})", "en": en, "description": html})
                table[term] = "SUPP:" + supp_uuid(key)
                st["supp"] += 1
    for name, table in tables.items():
        if name in ("spell", "feat"):
            # 子代理给的是属性块原样（「深重绝望（DC19）」「强化天生武器（爪抓）」），plan.py 查的是去掉括注的名字：两个都记
            for term, t in list(table.items()):
                bare = re.sub(r"\s*[（(].*$", "", term).strip()
                bare = re.sub(r"\s*(?:\b[A-Z]{1,4}\b|\*+)\s*$", "", bare).strip()  # 「寒冰击UM」「深渊之礼*」「消失 APG」
                if bare and bare != term and bare not in table:
                    table[bare] = t
        (OUT / f"{name}.json").write_text(json.dumps(table, ensure_ascii=False, indent=0), encoding="utf8")
    (OUT / "supplement_attacks.json").write_text(json.dumps(list(supp_attack.values()), ensure_ascii=False, indent=0), encoding="utf8")
    (OUT / "supplement_abilities.json").write_text(json.dumps(list(supp_ability.values()), ensure_ascii=False, indent=0), encoding="utf8")
    print(stats)
    print("补充攻击", len(supp_attack), "补充能力", len(supp_ability))


if __name__ == "__main__":
    main()
