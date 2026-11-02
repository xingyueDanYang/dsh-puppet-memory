#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""gen-lunar-map.py -- 生成 opening-lunar-map.json（农历 -> 阳历换算表）

为什么要脚本：农历「月-日」不是每年都存在（小月 29 天没有三十、闰月会挪位置），
在模型这边手算农历必错，所以换算表一次性生成、插件只读。

规则（丹阳 2026-11-02 定）：
  - 该年的那个农历日不存在时，按 **提前** 处理（例如腊月只有廿九 → 腊月三十的生日提前到廿九）。
    理由：提前过还能补过，延后就没有机会了（腊月三十 = 除夕，不存在那年除夕就是廿九）。
  - 闰月按**常规月**算，闰月不另开一天。

用法：
  python gen-lunar-map.py                # 读 <DSH_MEMORY>/deep/opening-table.jsonl 里的 lunar 键
  python gen-lunar-map.py 09-16 12-30    # 或显式给键
  选项：--from-year 1997 --to-year 2065 --out <路径>

输出格式（同一年的三种状态）：
  {"09-16": {"2026": {"date": "2026-10-25", "kind": "exact", "lunarDay": 16}, ...},
   "12-30": {"2026": {"date": "2027-02-05", "kind": "shift_before", "lunarDay": 29, "note": "该年腊月只有 29 天"}, ...}}
"""
import argparse
import json
import os
import sys

try:
    from lunardate import LunarDate
except ImportError:
    sys.exit("需要 lunardate：pip install lunardate")

DEFAULT_HOME = os.path.join(os.path.expanduser("~"), ".dsh", "memory")
MONTH_NAMES = {1: "正", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九", 10: "十", 11: "冬", 12: "腊"}


def month_len(year, month):
    """该农历月有多少天：正月/腊月可能 29 或 30"""
    for dd in (30, 29):
        try:
            # 注意：构造函数不校验「日」，必须真的换算一次才会抛 ValueError("day out of range")
            LunarDate(year, month, dd).to_solar_date()
            return dd
        except Exception:
            continue
    return 29


def resolve(year, month, day):
    """返回 (solar_date, kind, actual_day, note)"""
    try:
        d = LunarDate(year, month, day).to_solar_date()
        return d, "exact", day, ""
    except Exception:
        pass
    mlen = month_len(year, month)
    if day > mlen:
        # 提前到该月最后一天
        d = LunarDate(year, month, mlen).to_solar_date()
        note = "%s月只有 %d 天（没有%s十%s），按提前算" % (MONTH_NAMES.get(month, month), mlen, "", "")
        note = "该年%s月只有 %d 天，按提前算" % (MONTH_NAMES.get(month, month), mlen)
        return d, "shift_before", mlen, note
    # 理论上不会有别的缺失；实在不行给 None
    return None, "missing", None, "该年这个农历日无法解析"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="*", help="农历键，如 09-16 12-30；不给就读 opening-table.jsonl")
    ap.add_argument("--from-year", type=int, default=1997)
    ap.add_argument("--to-year", type=int, default=2065)
    ap.add_argument("--out", default=None)
    ap.add_argument("--home", default=DEFAULT_HOME)
    args = ap.parse_args()

    out = args.out or os.path.join(args.home, "deep", "opening-lunar-map.json")
    table = os.path.join(args.home, "deep", "opening-table.jsonl")
    keys = list(args.keys)
    if not keys:
        if not os.path.exists(table):
            sys.exit("没有给键，也找不到 %s" % table)
        seen = []
        with open(table, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                k = str(row.get("lunar") or "").strip()
                if k and k not in seen:
                    seen.append(k)
        keys = seen
    if not keys:
        sys.exit("表里没有 lunar 条目，也没有显式给键")

    result = {}
    for key in keys:
        try:
            mm, dd = [int(x) for x in key.split("-")]
        except Exception:
            sys.exit("键格式不对：%s（要 月-日，如 09-16）" % key)
        per_year = {}
        for y in range(args.from_year, args.to_year + 1):
            d, kind, actual, note = resolve(y, mm, dd)
            if d is None:
                continue
            item = {"date": d.isoformat(), "kind": kind, "lunarDay": actual}
            if note:
                item["note"] = note
            per_year[str(y)] = item
        result["%02d-%02d" % (mm, dd)] = per_year

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    total = sum(len(v) for v in result.values())
    shifted = sum(1 for v in result.values() for it in v.values() if it["kind"] != "exact")
    print("写入 %s：%d 个键 / %d 年条目（其中 %d 条按提前处理）" % (out, len(result), total, shifted))


if __name__ == "__main__":
    main()
