"""给 audit.json 里没对上的名字配候选（按中文双字重合度），切成工作包 work/<类>_<n>.json，交给子代理挑别名。"""
import json, re, collections
from pathlib import Path
ROOT = Path(r"E:/FoundryV13/monsters")
IDX = json.loads((ROOT / "index.json").read_text(encoding="utf8"))
G = IDX["groups"]
A = json.loads((ROOT / "audit.json").read_text(encoding="utf8"))
TR = Path(r"E:/FoundryV13/data/Data/modules/pf1e_compendium_chn/translations")
EXPORT = Path(r"E:/FoundryV13/zh-build/export")

# uuid → 英文名
U2EN = {}
for f in EXPORT.glob("*.json"):
    for d in json.loads(f.read_text(encoding="utf8")):
        if d.get("_coll") in ("items", "actors"):
            U2EN[f"Compendium.{f.stem}.{'Item' if d['_coll'] == 'items' else 'Actor'}.{d['_id']}"] = d["name"]

NAT = {u: U2EN.get(u) for u in set(G["ability"]["en"].values()) if "monster-abilities" in u}
WEAPONS = {z: u for z, u in G["gear"]["zh"].items() if "weapons-and-ammo" in u}
CATS = {
    "feat": ["feat"], "spell": ["spell", "classfeat"], "gear": ["gear"],
    "attack": ["_weapons", "_natural"], "ability_notext": ["ability", "classfeat", "racialtrait", "feat"],
}


def bigrams(s):
    s = re.sub(r"[^\u4e00-\u9fff]", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)} | set(s)


def pool(groups):
    out = {}
    for g in groups:
        if g == "_weapons":
            out.update({z: (u, "gear") for z, u in WEAPONS.items()})
        elif g == "_natural":
            for k, u in G["ability"]["zh"].items():
                if "monster-abilities" in u:
                    out[k] = (u, "natural")
        else:
            for z, u in G[g]["zh"].items():
                out.setdefault(z, (u, g))
    inv = collections.defaultdict(set)
    for z in out:
        for b in bigrams(z):
            inv[b].add(z)
    return out, inv


def main():
    work = ROOT / "work"
    work.mkdir(exist_ok=True)
    for f in work.glob("*.json"):
        f.unlink()
    for cat, groups in CATS.items():
        names, inv = pool(groups)
        items, merged = [], {}
        for term, x in A.get(cat, {}).items():
            if cat in ("gear", "attack"):  # 「+1矛」「天生护甲护符+2」只配基础名，+N 搭建时接回去
                term = re.sub(r"\s*\+\d\s*", "", term).strip() or term
            m = merged.setdefault(term, {"n": 0, "ex": []})
            m["n"] += x["n"]
            m["ex"] += x["ex"]
        for term, x in sorted(merged.items(), key=lambda kv: -kv[1]["n"]):
            core = re.sub(r"[（(].*$", "", term).strip()
            tb = bigrams(core)
            score = collections.Counter()
            for b in tb:
                for z in inv.get(b, ()):
                    score[z] += 2 if len(b) == 2 else 1
            cands = []
            for z, sc in score.most_common(40):
                zb = bigrams(z)
                j = len(tb & zb) / max(1, len(tb | zb)) + (0.5 if core in z or z in core else 0)
                cands.append((j, z))
            cands.sort(reverse=True)
            items.append({"term": term, "n": x["n"], "ex": x["ex"][:2],
                          "cands": [f"{z} | {U2EN.get(names[z][0], '?')} | {names[z][1]}" for j, z in cands[:10]]})
        size = 160
        for i in range(0, len(items), size):
            (work / f"{cat}_{i // size + 1:02d}.json").write_text(json.dumps(items[i:i + size], ensure_ascii=False, indent=0), encoding="utf8")
        print(cat, len(items), "包", (len(items) + size - 1) // size)


if __name__ == "__main__":
    main()
