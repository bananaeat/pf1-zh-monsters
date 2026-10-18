"""对全部怪物跑一遍 plan_for（不建角色），统计缺什么：专长、法术、装备、攻击、没有全文的能力。
python audit.py → audit.json（每类：名字 → 次数、举例怪物）、plans_all.json（全部建造计划，按出处排）"""
import json, pickle, re, sys, collections
from pathlib import Path
import plan

E, *_ = pickle.loads(Path(r"E:/FoundryV13/zh-build/wiki_cache.pkl").read_bytes())
plan.E_ALL = E
GEAR = json.loads(Path(r"E:/FoundryV13/data/Data/zh-monsters/gear_index.json").read_text(encoding="utf8"))


def gear_hit(zh):
    """findGear 的 Python 版（近似）。"""
    base = re.sub(r"\[.*?\]", "", zh).strip()
    base = re.sub(r"^(精制品|精致|精制|精工|破损|无匹)", "", base)
    base = re.sub(r"^(寒铁|冷铁|炼金银|炼银|银质|秘银|精金|暗木|龙骨|水晶|骨质|骨制|石质|黑曜石|铁木|银)(?=..)", "", base)
    tries = [zh, base]
    m = re.match(r"^(.*?)\s*\+(\d)$", base)
    if m:
        tries.append(f"+{m.group(2)}{m.group(1)}")
    core = re.sub(r"^\+\d\s*", "", zh)
    core = re.sub(r"[（(].*$", "", core)
    core = re.sub(r"^(精制品|精致|精制|精工)", "", core).strip()
    if re.match(r"^\+\d", zh) or core != zh:
        tries += [core[i:] for i in range(len(core) - 1)]
    tries += [t.replace(" ", "") for t in tries]
    return any(t in GEAR for t in tries)


def main():
    out = collections.defaultdict(lambda: collections.defaultdict(lambda: {"n": 0, "ex": []}))
    plans, seen, err = [], set(), []
    plan.KNOWN.update(k for k in plan.G["race"]["zh"] if plan.re.search("[一-鿿]", k))
    plan.KNOWN.update(e["raw"].get("name") or "" for e in E["creatures"])
    plan.KNOWN.discard("")
    for e in E["creatures"]:
        r = e["raw"]
        key = (e["title"], r.get("english_name"), r.get("name"))
        if key in seen:
            continue
        seen.add(key)
        try:
            p = plan.plan_for(e)
        except Exception as ex:  # noqa
            err.append((r.get("english_name"), str(ex)[:80]))
            continue
        p["page"] = e["title"]
        plans.append(p)
        who = f'{p["zh"]}（{p.get("source")}）'

        def add(cat, name, ctx=None):
            x = out[cat][name]
            x["n"] += 1
            if len(x["ex"]) < 3:
                x["ex"].append(who + (f"：{ctx}" if ctx else ""))
        for f in p["featsMissing"]:
            add("feat", f["raw"], (e["raw"].get("feats") or "")[:120])
        for b in (p["sla"], p["spells"]):
            if b:
                for g in b["groups"]:
                    for s in g["spells"]:
                        if not s["uuid"] and not s.get("featUuid"):
                            add("spell", s["raw"], b.get("title"))
        for a in p["abilitiesItems"]:
            if not a["uuid"] and re.sub(r"<[^>]+>", "", a.get("text") or "").strip() == a.get("raw", "").strip():
                add("ability_notext", a["name"], a.get("raw"))
        for g in p.get("gearList") or []:
            if "currency" in g:
                add("_currency", g["currency"])
            elif "consumable" in g:
                add("_consumable", g["consumable"])
            elif not gear_hit(g["zh"]):
                add("gear", g["zh"], g.get("raw"))
        for a in p["attacks"]:
            if not a["natural"] and not gear_hit(a["name"]):
                add("attack", a["name"], f'{a["name"]} {a["bonus"]} ({a["dice"]}) {a["extra"]}')
    res = {cat: dict(sorted(v.items(), key=lambda kv: -kv[1]["n"])) for cat, v in out.items()}
    Path("audit.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf8")
    Path(r"E:/FoundryV13/data/Data/zh-monsters/plans_all.json").write_text(json.dumps(plans, ensure_ascii=False), encoding="utf8")
    print("plans", len(plans), "errors", len(err), err[:5])
    for cat, v in res.items():
        tot = sum(x["n"] for x in v.values())
        print(f"== {cat}: {len(v)} 种 / {tot} 次")
        print("   ", "；".join(f"{k}×{x['n']}" for k, x in list(v.items())[:40]))


if __name__ == "__main__":
    main()
