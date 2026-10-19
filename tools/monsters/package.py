"""打包：把合集包汉化（pf1e_compendium_chn 的翻译、转换器、系统界面翻译）和自制怪物合集包（pf1-zh-monsters）合成一个模组。

    python package.py            → E:\\FoundryV13\\dist\\pf1-zh-monsters\\ 和 pf1-zh-monsters-<版本>.zip

模组 id 沿用 pf1-zh-monsters：3646 只怪和补充条目都用 Compendium.pf1-zh-monsters.* 互相引用，换 id 会断。
开发用的两个模组（data/Data/modules 下）不动；装这个合成版的世界里不要再开那两个。
"""
import json, re, shutil, subprocess, zipfile
from pathlib import Path

VERSION = "1.0.2"
REPO = "bananaeat/pf1-zh-monsters"  # 怪物版发布在这里（GitHub Release 放 zip 和 module.json）
MODS = Path(r"E:/FoundryV13/data/Data/modules")
CHN, MON = MODS / "pf1e_compendium_chn", MODS / "pf1-zh-monsters"
WIKI = Path(r"E:/PF/PFWiki/release/pf1-zh-wiki-data")
DIST = Path(r"E:/FoundryV13/dist")
ID = "pf1-zh-monsters"
NODE_COMPACT = r"""
const { ClassicLevel } = require(process.argv[2]);
(async () => {
  for (const dir of process.argv.slice(3)) {
    const db = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "utf8" });
    await db.open();
    let n = 0;
    for await (const _ of db.keys()) n++;
    await db.compactRange("!", "~");
    await db.close();
    console.log(dir.split(/[\\/]/).pop(), n);
  }
})().catch((e) => { console.error(e); process.exit(1); });
"""


def main():
    import sys
    for e in (sys.argv[1:] or ["full", "monsters"]):
        build(e)


def build(edition):
    full = edition == "full"
    OUT = DIST / edition / ID
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    # 1) 汉化（只有合成版）：脚本、样式、翻译、系统界面翻译、标签词表；脚本里的模组 id 换成合成版的
    if full:
        for sub in ("scripts", "styles", "translations"):
            shutil.copytree(CHN / sub, OUT / sub)
        for f in ("cn.json", "tags.json"):
            shutil.copy2(CHN / f, OUT / f)
        for f in (OUT / "scripts").glob("*.*js"):
            s = f.read_text(encoding="utf8")
            f.write_text(s.replace("pf1e_compendium_chn", ID), encoding="utf8")
    # 2) 怪物合集包：复制后压实（反复重建留下的旧数据去掉）
    shutil.copytree(MON / "packs", OUT / "packs", ignore=shutil.ignore_patterns("LOCK", "LOG", "LOG.old"))
    dirs = [str(d) for d in sorted((OUT / "packs").iterdir()) if d.is_dir()]
    js = DIST / f"_compact_{edition}.cjs"
    js.write_text(NODE_COMPACT, encoding="utf8")
    r = subprocess.run(["node", str(js), r"E:/FoundryV13/app/node_modules/classic-level", *dirs], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    js.unlink()
    if r.returncode:
        raise SystemExit("压实失败")
    # 3) 清单
    chn, mon = json.loads((CHN / "module.json").read_text(encoding="utf8")), json.loads((MON / "module.json").read_text(encoding="utf8"))
    manifest = {
        "id": ID,
        "title": "PF1 中文合集包（汉化 + 中文怪物图鉴）",
        "description": "PF1e 合集包的中文翻译（Babele；以 FVTT-CN 汉化为底，按 PFWiki 补全、校正），加上用 PFWiki 中文属性块搭建的 3649 个怪物与 NPC（怪物图鉴 1–6、NPC 志、怪物志、其他出处）。需要 Babele。",
        "version": VERSION,
        "compatibility": {"minimum": "13", "verified": "13"},
        "authors": [{"name": "社区译者（PFWiki 汇集）", "url": "https://pf1.huijiwiki.com"}, {"name": "FVTT-CN（合集包汉化底本）", "url": "https://github.com/fvtt-cn"},
                    {"name": "bananaeat（整理）", "url": "https://github.com/bananaeat"}],
        "languages": chn["languages"],
        "esmodules": chn["esmodules"],
        "styles": chn["styles"],
        "packs": mon["packs"],
        "packFolders": mon["packFolders"],
        "relationships": {
            "systems": [{"id": "pf1", "type": "system", "compatibility": {"minimum": "11.0"}}],
            "requires": [{"id": "babele", "type": "module", "compatibility": {"minimum": "2.5.2"}}],
            "conflicts": [{"id": "pf1e_compendium_chn", "type": "module", "reason": "本模组已包含同样的合集包翻译，两个一起开会重复注册"}],
        },
        "license": "LICENSE",
    }
    if not full:
        for k in ("languages", "esmodules", "styles"):
            manifest.pop(k)
        manifest["title"] = "PF1 中文怪物图鉴"
        manifest["description"] = "用 PFWiki 中文属性块搭建的 3649 个 PF1 怪物与 NPC（怪物图鉴 1–6、NPC 志、怪物志、其他出处）。合集包条目的中文名和说明配合 pf1e_compendium_chn 使用。"
        manifest["relationships"] = {"systems": manifest["relationships"]["systems"],
                                     "recommends": [{"id": "pf1e_compendium_chn", "type": "module", "reason": "合集包条目（专长、法术、物品）的中文翻译"}]}
        manifest.update({
            "url": f"https://github.com/{REPO}",
            "bugs": f"https://github.com/{REPO}/issues",
            "readme": f"https://github.com/{REPO}#readme",
            "changelog": f"https://github.com/{REPO}/blob/main/CHANGELOG.md",
            "manifest": f"https://github.com/{REPO}/releases/latest/download/module.json",
            "download": f"https://github.com/{REPO}/releases/download/v{VERSION}/{ID}-bestiary-{VERSION}.zip",
        })
    (OUT / "module.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8")
    # 4) 授权与说明
    shutil.copy2(WIKI / "LICENSE", OUT / "LICENSE")
    shutil.copy2(WIKI / "OGL.txt", OUT / "OGL.txt")
    (OUT / "NOTICE.md").write_text(NOTICE, encoding="utf8")
    (OUT / "README.md").write_text((README if full else README_MON).format(version=VERSION), encoding="utf8")
    if not full:
        (OUT / "CHANGELOG.md").write_text(CHANGELOG, encoding="utf8")
    # 5) 压缩包
    z = DIST / f"{ID}-{'full' if full else 'bestiary'}-{VERSION}.zip"
    if z.exists():
        z.unlink()
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for f in sorted(OUT.rglob("*")):
            if f.is_file():
                zf.write(f, Path(ID) / f.relative_to(OUT))
    if not full:
        shutil.copy2(OUT / "module.json", DIST / "module.json")  # Release 里单独放一份，manifest 地址指向它
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"{OUT}  {size / 1e6:.1f} MB；{z.name}  {z.stat().st_size / 1e6:.1f} MB")


NOTICE = """# 授权与署名

## 译文的作者

本模组里的中文属性块和条目译文，出自 Pathfinder 1e 中文社区的译者：民间汉化 CHM 与论坛时期的译者，以及在开拓者1版中文维基（PFWiki，https://pf1.huijiwiki.com）上持续补译、校对和整理的编者。PFWiki 把这些译文汇集在一处，本模组按维基上的版本整理成 Foundry VTT 可用的数据。

- 译文依 **CC BY-SA 4.0** 授权（见 `LICENSE`）。本模组中的译文与整理同样以 CC BY-SA 4.0 分享：转载、改编须署名，并以相同协议发布。
- 合集包条目（专长、法术、职业能力、物品……）的中文以 FVTT-CN 的 pf1e_compendium_chn 为底本（https://github.com/fvtt-cn/pf1e_compendium_chn），并按 PFWiki 补全、校正。
- 怪物身上的条目复制自 Pathfinder 1e 系统、pf-content、pf1e-archetypes 的合集包，数据结构归各项目所有。
- 少数属性块在维基上标注为「AI 从英文译出」，未经人工校对，怪物传记末尾有说明。
- 整理：bananaeat。

## Paizo 社区使用政策

本模组使用了 Paizo Inc. 拥有的商标和／或版权内容，依 Paizo 社区使用政策（https://paizo.com/licenses/communityuse）使用。不得就使用或获取这些内容收取任何费用。本模组并非 Paizo 出版，也未经 Paizo 认可或特别批准。

This module uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy (paizo.com/licenses/communityuse). We are expressly prohibited from charging you to use or access this content. This module is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit paizo.com.

## 开放游戏内容

规则内容依 Open Game License v1.0a 使用，见 `OGL.txt`。
"""

README = """# PF1 中文合集包（汉化 + 中文怪物图鉴） v{version}

## 内容
- **合集包汉化**：pf1、pf-content、pf1e-archetypes 各合集包的中文名与正文（Babele 翻译），以 FVTT-CN 汉化为底，按 PFWiki 补全和校正；附系统界面翻译。
- **中文怪物图鉴**（合集包文件夹「PF1 中文怪物」）：怪物图鉴 1–6、NPC 志、怪物志、其他出处，共 3649 个怪物与 NPC，另有「补充条目」（合集包里没有、怪物要用的攻击、能力、药水卷轴魔杖）。
  - 专长、法术、能力、职业、种族、装备都复制自 pf1 / pf-content 合集包里的同一条目；HP、AC、豁免、BAB、CMB/CMD、先攻、技能、施法者等级、专注、法术 DC 由 PF1 自动计算，与属性块的差值放在「属性块修正」能力和法术书公式里，结果与属性块一致。
  - 每个怪物有种族（核心种族或怪物自身），能力分在种族特性 / 职业能力；魔法武器的附魔附规则说明，常见附魔已做成攻击伤害（炽焰等不倍增、爆发类重击加值、神圣与破敌为条件加值）。

## 需要
- Foundry VTT v13、Pathfinder 1e 系统、Babele 模组；中文界面建议同时安装 PF1 中文系统翻译。
- 本模组已包含 pf1e_compendium_chn 的全部翻译：**不要同时启用 pf1e_compendium_chn**。

## 安装
把压缩包解压到 Foundry 的 `Data/modules/`（得到 `Data/modules/pf1-zh-monsters/`），重启 Foundry，在世界的模组管理里启用 Babele 和本模组。

## 已知问题
- 变体职业只按基础职业建；第二套法术书并入第一本；少数属性块没写生命骰的怪 HP 对不上；合集包里没有的条目（3.5 专长、只有神话版的专长、写在法术栏里的领域能力）没有对应物品。
- 授权与署名见 `NOTICE.md`。
"""

README_MON = """# PF1 中文怪物图鉴 v{version}

用 PFWiki 中文属性块搭建的 3649 个 PF1 怪物与 NPC（合集包文件夹「PF1 中文怪物」：怪物图鉴 1–6、NPC 志、怪物志、其他出处，另有「补充条目」）。
数值由 PF1 自动计算并校准到属性块（HP、AC、豁免、BAB、CMB/CMD、先攻、技能、施法者等级、专注、法术 DC）；每个怪物有种族，能力分在种族特性 / 职业能力；魔法武器附附魔说明与常见附魔的攻击效果。

## 需要
- Foundry VTT v13、Pathfinder 1e 系统。
- 建议同时装 **pf1e_compendium_chn**（合集包汉化，需要 Babele）：怪物身上的条目已是中文，但从合集包拖新的专长、法术等要靠它。
- 可以和 **Roll Bonuses** 一起用。专攻、专精、精通重击等专长的加值已经算在数值里，不要在 Roll Bonuses 里给它们选武器或学派。

## 安装
- 在 Foundry 的「附加模组 → 安装模组」底部填清单地址：`https://github.com/bananaeat/pf1-zh-monsters/releases/latest/download/module.json`，以后可以直接在 Foundry 里更新。
- 或者从 Release 下载 zip，解压到 `Data/modules/`（得到 `Data/modules/pf1-zh-monsters/`），重启 Foundry。
- 在世界的模组管理里启用。合集包在「PF1 中文怪物」文件夹下。
- 已经拖进世界的角色不会随模组更新；想要新版，从合集包重新导入。

授权与署名见 `NOTICE.md`。
"""

CHANGELOG = """# 更新记录

## 1.0.2（2026-10-19）

- 跟进 PFWiki 到 2026-10-19 的更新：618 个属性块有改动，按新版重建（名词统一，如「锐锋」「冻寒」「近距射击」；装备、能力、专长、法术等的修订；传记文字）。
- 89 个 NPC 在维基上改了名字（NPC 志、游戏主持人指南等，87 个中文名、2 个英文名），合集包里换成新名字；新增 4 个属性块（惧怖冒险）；删掉 1 个维基上已经没有的（进化神话枭熊）。共 3649 个。
- 185 个原先标注「AI 从英文译出」的属性块已在维基上人工校对，去掉了标注；现在还有 1329 个带标注。
- 修正：游戏主持人指南的「海盗船长」有两份、Isles of the Shackles 的「海盗船长」（CR 5）缺失，现在各一份。
- 补充条目同步：新增 5 个卷轴、魔杖。
- 改动和新增的属性块都在干净世界里重建，数值和攻击全部与属性块一致。
- 已经拖进世界的怪物不会自动更新，请从合集包重新导入。

## 1.0.1（2026-10-18）

- 修正：有「武器娴熟」的怪物，天然攻击和灵巧武器的攻击加值偏低（少了敏捷与力量调整值之差，最多少 11）。这些攻击现在直接用敏捷计算，再按属性块校准。涉及 473 只怪、718 个攻击（天然攻击 480 个，短剑、匕首、细剑等武器 238 个）。
- 和 Roll Bonuses 模组兼容：武器娴熟的攻击已经用敏捷，它不会再替换一次；武器专攻、武器专精、法术专攻、精通重击等专长预先带上它的识别标记、不选武器或学派，它不会再自动配置。这些专长的加值已经算在怪物数值里，请不要在 Roll Bonuses 里给它们选武器或学派，否则会重复计算。
- 全量核对加上了攻击：全部怪物的每个攻击，攻击加值和伤害常数都与属性块一致。
- 已经拖进世界的怪物不会自动更新，请从合集包重新导入。
- 已知问题同 1.0.0。

## 1.0.0（2026-10-18）

首个公开版本。

- 3646 个怪物与 NPC：怪物图鉴 1–6、NPC 志、怪物志、其他出处（按出处分文件夹），另有「补充条目」533 条（合集包里没有、怪物要用的攻击、能力、药水卷轴魔杖）。
- 属性块来自 PFWiki 的中文版本；专长、法术、能力、职业、种族、装备都复制自 pf1 / pf-content / pf1e-archetypes 合集包里的同一条目。
- 数值由 PF1 自动计算再校准到属性块：HP、AC（普通/接触/措手不及）、三项豁免、BAB、CMB、CMD、先攻、各项技能、施法者等级、专注、每个法术的豁免 DC。差值放在「属性块修正」能力和法术书公式里，删掉即可看到系统原始结果。
- 每个怪物有种族：核心种族（719）或怪物自身（2927，类型与子类照属性块）；能力分在种族特性 / 职业能力（神话能力归职业能力）；神话专长用神话版。
- 魔法武器、护甲附「附魔」规则说明；常见武器附魔做成攻击效果：炽焰等能量伤害不倍增，焰爆等爆发类与雷鸣在重击时加值，神圣/邪恶/公理/混沌与破敌为攻击对话框里的条件加值。
- 全部武器显示在战斗栏；奖励专长写进奖励专长公式，专长栏不显示超额。

### 已知问题
- 变体职业只按基础职业建；第二套法术书并入第一本。
- 3 个属性块没写生命骰的怪 HP 对不上；少数攻击和属性块差 1（精制品弹药、集群攻击自动命中）。
- 合集包里没有的条目没有对应物品：3.5 专长、只有神话版的专长、写在法术栏里的领域能力、召唤类通用能力。
"""

if __name__ == "__main__":
    main()
