"""补充合集包的条目清单 → data/Data/zh-monsters/supplement.json（Foundry 里 syncSupplement() 照单建）。
- 消耗品：怪物装备里的药水/卷轴/魔杖/油，按（类型, 法术, 施法者等级）各一条，由 PF1 的 toConsumable 从法术生成。
- 攻击、能力：别名表里标了「合集包里没有」的（英文名 + 中文名 + 维基正文），见 aliases/supplement_*.json。"""
import json
from pathlib import Path
from supp_ids import supp_id

ROOT = Path(r"E:/FoundryV13/monsters")
DATA = Path(r"E:/FoundryV13/data/Data/zh-monsters")


def main():
    plans = json.loads((DATA / "plans_all.json").read_text(encoding="utf8"))
    out = {}
    for p in plans:
        for g in p.get("gearList") or []:
            if "consumable" in g and g["key"] not in out:
                out[g["key"]] = {"_id": supp_id(g["key"]), "key": g["key"], "kind": "consumable", "type": g["consumable"],
                                 "spell": g["spell"], "cl": g["cl"]}
    for f in sorted(ROOT.glob("aliases/supplement_*.json")):
        for e in json.loads(f.read_text(encoding="utf8")):
            out[e["key"]] = {**e, "_id": supp_id(e["key"])}
    (DATA / "supplement.json").write_text(json.dumps(list(out.values()), ensure_ascii=False, indent=0), encoding="utf8")
    import collections
    print(collections.Counter(e["kind"] + ":" + e.get("type", "") for e in out.values()))


if __name__ == "__main__":
    main()
