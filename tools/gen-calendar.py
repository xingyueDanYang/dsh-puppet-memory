#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""gen-calendar.py -- 生成 calendar-table.json（阳历↔农历 / 节气 / 节日）

为什么要表：农历大小月、闰月、节气都不是简单算式，模型手算必错。
一张表生成一次、插件只查表，不依赖 python、不联网。

用法：
  python gen-calendar.py                  # 默认 2024-2036
  python gen-calendar.py --from 2024 --to 2040 --out <路径>

输出结构：
  {"from": 2024, "to": 2036, "generated": "...",
   "years": {"2026": {
      "lunar": {"2026-11-23": [10, 15, false]},   # 农历月、日、是否闰月
      "terms": {"小雪": "2026-11-22", ...},        # 24 节气
      "festivals": {"春节": "2026-02-17", ...}     # 农历节日 + 公历节日
   }}}
"""
import argparse
import datetime
import json
import os
import sys

from cnlunar import Lunar

LUNAR_FESTIVALS = {
    (1, 1): "春节",
    (1, 15): "元宵",
    (5, 5): "端午",
    (7, 7): "七夕",
    (7, 15): "中元",
    (8, 15): "中秋",
    (9, 9): "重阳",
    (12, 8): "腊八",
}
SOLAR_FESTIVALS = {
    (1, 1): "元旦",
    (2, 14): "情人节",
    (5, 1): "劳动节",
    (5, 4): "青年节",
    (6, 1): "儿童节",
    (9, 10): "教师节",
    (10, 1): "国庆",
    (12, 25): "圣诞",
}


def build(from_year, to_year):
    out = {"from": from_year, "to": to_year, "generated": datetime.date.today().isoformat(), "years": {}}
    for y in range(from_year, to_year + 1):
        year = {"lunar": {}, "terms": {}, "festivals": {}}
        day = datetime.date(y, 1, 1)
        last_lunar = None
        while day.year == y:
            l = Lunar(datetime.datetime(day.year, day.month, day.day, 12, 0))
            lm, ld, leap = int(l.lunarMonth), int(l.lunarDay), bool(l.isLunarLeapMonth)
            year["lunar"][day.isoformat()] = [lm, ld, leap]
            if not leap and not day.isoweekday() == 0:
                pass
            if not leap:
                key = (lm, ld)
                if key in LUNAR_FESTIVALS and LUNAR_FESTIVALS[key] not in year["festivals"]:
                    year["festivals"][LUNAR_FESTIVALS[key]] = day.isoformat()
            s_key = (day.month, day.day)
            if s_key in SOLAR_FESTIVALS:
                year["festivals"][SOLAR_FESTIVALS[s_key]] = day.isoformat()
            last_lunar = (day.isoformat(), lm, ld, leap)
            day += datetime.timedelta(days=1)
        # 除夕：该年最后一个农历腊月（除夕可能落在次年 1 月，按落在本年的那天算）
        for y2 in (y, y + 1):
            for iso, lm, ld, leap in [(k, v[0], v[1], v[2]) for k, v in out["years"].get(str(y2), {}).get("lunar", {}).items()] if str(y2) in out["years"] else []:
                pass
        terms = Lunar(datetime.datetime(y, 6, 1, 12, 0)).thisYearSolarTermsDic
        for name, (m, d) in (terms or {}).items():
            year["terms"][name] = datetime.date(y, m, d).isoformat()
        out["years"][str(y)] = year
    # 除夕单独补：= 次年春节前一天（公历跨年的除夕归到春节那年）
    for y in range(from_year, to_year + 1):
        nxt = out["years"].get(str(y + 1))
        spring = (nxt or {}).get("festivals", {}).get("春节") if nxt else None
        if spring:
            eve = (datetime.date.fromisoformat(spring) - datetime.timedelta(days=1)).isoformat()
            out["years"][str(y)]["festivals"]["除夕"] = eve
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="fy", type=int, default=2024)
    ap.add_argument("--to", dest="ty", type=int, default=2036)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "calendar-table.json"))
    a = ap.parse_args()
    data = build(a.fy, a.ty)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(a.out)
    print("写出 %s（%d 年，%.0f KB）" % (a.out, a.ty - a.fy + 1, size / 1024))
    for k in ("春节", "中秋", "除夕", "小雪"):
        print(" 2026 %s =" % k, data["years"]["2026"]["festivals"].get(k) or data["years"]["2026"]["terms"].get(k))


if __name__ == "__main__":
    main()
