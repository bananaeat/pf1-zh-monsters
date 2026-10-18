"""中文名 → 已有合集包条目（uuid）的索引，供怪物属性块转换用。

两个来源：
1. 我们生成的译文（pf1e_compendium_chn/translations）：英文原名 → 「中文 (English)」，取中文部分；
2. PFWiki 条目和页面：维基标题/条目名 → english_name → 合集包里同名英文条目。
属性块里的 [[链接]] 指向维基标题，没链接的写的是条目中文名，两种都要能查。
"""
import json
import pickle
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, r"E:/FoundryV13/zh-build/src")
from wiki import norm, name_variants  # noqa: E402

EXPORT = Path(r"E:/FoundryV13/zh-build/export")
TRANS = Path(r"E:/FoundryV13/data/Data/modules/pf1e_compendium_chn/translations")
OUT = Path(r"E:/FoundryV13/monsters/index.json")

# 每类按优先级排：核心包在前
GROUPS = {
    "feat": ["pf1.feats", "pf-content.pf-feats"],
    "spell": ["pf1.spells"],
    "ability": ["pf1.monster-abilities", "pf-content.pf-universal-monster-rules", "pf1.template-abilities", "pf-content.pf-special-qualities"],
    "gear": ["pf1.weapons-and-ammo", "pf1.armors-and-shields", "pf1.items", "pf-content.pf-items", "pf-content.pf-magic-items",
             "pf-content.pf-wondrous", "pf1.technology"],
    "racialhd": ["pf1.racial-hd"],
    "class": ["pf1.classes", "pf1e-archetypes.pf-prestige-classes"],
    "race": ["pf1.races"],
    "classfeat": ["pf1.class-abilities", "pf-content.pf-class-abilities", "pf1e-archetypes.pf-arch-features",
                  "pf1e-archetypes.pf-prestige-features"],
    "racialtrait": ["pf-content.pf-racial-traits"],
}
DOCNAME = {"items": "Item", "actors": "Actor"}


def zh_of(bilingual):
    m = re.match(r"^(.*?)\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*$", bilingual or "")
    z = m.group(1) if m else bilingual
    return z.strip() if z and re.search(r"[\u4e00-\u9fff]", z) else None


def main():
    E, P, S, PE = pickle.loads(Path(r"E:/FoundryV13/zh-build/wiki_cache.pkl").read_bytes())
    redirects = json.loads(Path(r"E:/PF/PFWiki/release/pf1-zh-wiki-data/wikitext/redirects.json").read_text(encoding="utf8"))
    redirects = redirects if isinstance(redirects, dict) else {r["from"]: r["to"] for r in redirects}

    idx = {}
    for grp, colls in GROUPS.items():
        en2uuid, zh2uuid, stripped = {}, {}, []
        for coll in colls:
            docs = [d for d in json.loads((EXPORT / f"{coll}.json").read_text(encoding="utf8")) if d.get("_coll") != "folders"]
            tr = {}
            f = TRANS / f"{coll}.json"
            if f.exists():
                tr = json.loads(f.read_text(encoding="utf8")).get("entries") or {}
            for d in docs:
                uuid = f"Compendium.{coll}.{DOCNAME[d['_coll']]}.{d['_id']}"
                for k in name_variants(d["name"]):
                    en2uuid.setdefault(k, uuid)
                base = re.sub(r"\s*\([^()]*\)\s*$", "", d["name"])  # 「Fast Swimmer (Locathah)」也按「Fast Swimmer」记
                if base != d["name"]:
                    for k in name_variants(base):
                        en2uuid.setdefault(k, uuid)
                z = zh_of((tr.get(d["name"]) or {}).get("name") if isinstance(tr.get(d["name"]), dict) else None)
                if z:
                    zh2uuid.setdefault(z, uuid)
                    pm = re.search(r"（(.*?)）$", z)
                    # 括号里正好是这件东西的英文名（「弩矢（Crossbow Bolt）」）的优先，括号里是限定词（「弩矢（grappling）」）的靠后
                    stripped.append((0 if pm and pm.group(1).strip().lower() == d["name"].strip().lower() else 1, re.sub(r"（.*?）$", "", z), uuid))
        # 去掉「（grappling）」之类限定的名字最后才补：「弩矢」要指普通弩矢，不能被「弩矢（grappling）」先占了
        for _, z, u in sorted(stripped, key=lambda x: x[0]):
            zh2uuid.setdefault(z, u)
        idx[grp] = {"en": en2uuid, "zh": zh2uuid}

    # 维基标题 → 英文名（条目卡片的 english_name、页面开头的「（English）」）
    title_en = {}
    for kind, lst in E.items():
        for e in lst:
            en = e["raw"].get("english_name") or e["raw"].get("英文名")
            if en:
                title_en.setdefault(e["title"], en)
                if e["raw"].get("name"):
                    title_en.setdefault(e["raw"]["name"], en)
                for a in re.split(r"[;；,，]", e["raw"].get("aliases") or ""):
                    if a.strip():
                        title_en.setdefault(a.strip(), en)
    for t, en in PE.items():
        title_en.setdefault(t, re.sub(r"\s*,\s*(Ex|Su|Sp).*$", "", en))
    # 全维基英文索引（zh-build/src/enindex.py）：中文 → 英文，补上卡片以外的小节标题、术语对照表、链接括注
    import sys
    sys.path.insert(0, r"E:/FoundryV13/zh-build/src")
    from enindex import enindex
    for k, recs in enindex().items():
        for r in recs:
            z = re.sub(r"[（(〔].*$", "", re.sub(r"<[^>]+>", "", r["zh"])).strip()
            if z and re.search(r"[一-鿿]", z):
                title_en.setdefault(z, k)
    out = {"groups": idx, "title_en": title_en, "redirects": redirects}
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf8")
    # build_actor.js 的 findGear 用：中文名 → uuid
    Path(r"E:/FoundryV13/data/Data/zh-monsters/gear_index.json").write_text(json.dumps(idx["gear"]["zh"], ensure_ascii=False), encoding="utf8")
    print({g: (len(v["en"]), len(v["zh"])) for g, v in idx.items()}, "title_en", len(title_en))


if __name__ == "__main__":
    main()
