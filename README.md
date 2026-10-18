# PF1 中文怪物图鉴 v1.0.0

用 PFWiki 中文属性块搭建的 3646 个 PF1 怪物与 NPC（合集包文件夹「PF1 中文怪物」：怪物图鉴 1–6、NPC 志、怪物志、其他出处，另有「补充条目」）。
数值由 PF1 自动计算并校准到属性块（HP、AC、豁免、BAB、CMB/CMD、先攻、技能、施法者等级、专注、法术 DC）；每个怪物有种族，能力分在种族特性 / 职业能力；魔法武器附附魔说明与常见附魔的攻击效果。

## 需要
- Foundry VTT v13、Pathfinder 1e 系统。
- 建议同时装 **pf1e_compendium_chn**（合集包汉化，需要 Babele）：怪物身上的条目已是中文，但从合集包拖新的专长、法术等要靠它。
- 另有「合成版」（pf1-zh-monsters-full）已经包含汉化；两个版本 id 相同，二选一。

## 安装
- 在 Foundry 的「附加模组 → 安装模组」底部填清单地址：`https://github.com/bananaeat/pf1-zh-monsters/releases/latest/download/module.json`，以后可以直接在 Foundry 里更新。
- 或者从 Release 下载 zip，解压到 `Data/modules/`（得到 `Data/modules/pf1-zh-monsters/`），重启 Foundry。
- 在世界的模组管理里启用。合集包在「PF1 中文怪物」文件夹下。
- 已经拖进世界的角色不会随模组更新；想要新版，从合集包重新导入。

## 反馈
数值、译名或规则对不上的，请到 https://github.com/bananaeat/pf1-zh-monsters/issues 反馈，写明怪物名和出处。

## 已知问题
- 变体职业只按基础职业建；第二套法术书并入第一本；少数属性块没写生命骰的怪 HP 对不上；合集包里没有的条目（3.5 专长、只有神话版的专长、写在法术栏里的领域能力）没有对应物品。
- 授权与署名见 `NOTICE.md`。

## 怎么生成的

`tools/` 里是生成脚本（在作者本机的离线 PFWiki 数据和 Foundry 测试服上运行，路径写死在脚本里，仅供参考）：
- `tools/monsters/plan.py`、`audit.py`：把 PFWiki 的中文属性块解析成建造计划（专长、法术、装备、攻击对到 pf1 / pf-content 合集包条目）。
- `tools/zh-monsters/build_actor.js`、`batch.js`：在 Foundry 里按计划建角色，由 PF1 自动计算再校准到属性块，导入合集包。
- `tools/monsters/package.py`：打包。
- `tools/zh-monsters/release_test.js`：发布前在干净世界里抽查。
- 详细做法和踩过的坑见 `tools/monsters/README.md`。

数值按**纯 PF1 系统**校准（不装 Roll Bonuses 等自动化模组）。装了这类模组的世界里，专长的自动加值可能和「属性块修正」重复。
