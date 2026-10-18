"""把发布用的文件同步到 GitHub 仓库目录（E:/FoundryV13/release/pf1-zh-monsters），再由 git 提交推送。

    python package.py monsters   # 先打包
    python release_repo.py       # 同步：清单、说明、授权、生成脚本
合集包（LevelDB）和 zip 不进仓库，作为 Release 附件上传。
"""
import shutil
from pathlib import Path

REPO = Path(r"E:/FoundryV13/release/pf1-zh-monsters")
BUILT = Path(r"E:/FoundryV13/dist/monsters/pf1-zh-monsters")
TOOLS = {
    "tools/monsters": (Path(r"E:/FoundryV13/monsters"), ["*.py", "README.md"]),
    "tools/zh-monsters": (Path(r"E:/FoundryV13/data/Data/zh-monsters"), ["build_actor.js", "batch.js", "release_test.js", "retag.js"]),
}
def main():
    REPO.mkdir(parents=True, exist_ok=True)
    for f in ("module.json", "NOTICE.md", "LICENSE", "OGL.txt", "CHANGELOG.md"):
        shutil.copy2(BUILT / f, REPO / f)
    readme = (BUILT / "README.md").read_text(encoding="utf8")
    (REPO / "README.md").write_text(readme, encoding="utf8", newline="\n")
    for dest, (src, pats) in TOOLS.items():
        d = REPO / dest
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        for pat in pats:
            for f in src.glob(pat):
                shutil.copy2(f, d / f.name)
    (REPO / ".gitignore").write_text("packs/\n*.zip\n__pycache__/\n", encoding="utf8", newline="\n")
    (REPO / ".gitattributes").write_text("* text=auto eol=lf\n", encoding="utf8", newline="\n")
    print(sorted(str(p.relative_to(REPO)) for p in REPO.rglob("*") if p.is_file() and ".git" not in p.parts))


if __name__ == "__main__":
    main()
