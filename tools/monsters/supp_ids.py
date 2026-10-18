"""补充合集包条目的固定 id：由键名算出，Python（plan.py、supplement.py）和 Foundry 两边一致。"""
import hashlib

PACK = "pf1-zh-monsters.supplement"
ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def supp_id(key):
    n = int.from_bytes(hashlib.sha1(key.encode("utf8")).digest(), "big")
    out = ""
    for _ in range(16):
        n, r = divmod(n, 62)
        out += ALPH[r]
    return out


def supp_uuid(key):
    return f"Compendium.{PACK}.Item.{supp_id(key)}"
