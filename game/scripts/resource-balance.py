"""Round-trip the building and harvest balance through UTF-8 CSV sheets."""
import argparse
import csv
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

CONFIG = Path(__file__).resolve().parents[1] / "assets/colony/resource-balance.json"
MATERIALS = "wood stone plank stoneBrick pigIron steel cloth components".split()
PARAMETERS = ["woodPerTrunkLevel", "stone.reserve", "stone.batch", "pigIron.reserve", "pigIron.batch"]


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return [[cell.strip() for cell in row] for row in csv.reader(stream, strict=True)]


def integer(cell, label, minimum=0):
    if not cell.isascii() or not cell.isdecimal() or not minimum <= int(cell) <= 1000000:
        raise ValueError(f"{label} 数量须为 {minimum}～1000000 的整数，收到 {cell!r}")
    return int(cell)


def check_keys(actual, expected, label):
    missing = set(expected) - set(actual)
    extra = set(actual) - set(expected)
    if missing or extra:
        raise ValueError(f"{label} 缺少 {sorted(missing)}，多出 {sorted(extra)}")


def building_costs(path, expected):
    table = rows(path)
    compact = bool(table and table[0] == ["id", *MATERIALS])
    if not compact and (len(table) < 2 or len(table[1]) < 22):
        raise ValueError("建筑 CSV 需要精简表头，或第 2 行为表头的飞书 B、O～V 列")
    found = {}
    for n, row in enumerate(table[1 if compact else 2:], 2 if compact else 3):
        if not any(row):
            continue
        start, end = (1, 9) if compact else (14, 22)
        if len(row) < end:
            raise ValueError(f"建筑表第 {n} 行缺材料列")
        key = row[0 if compact else 1]
        if key in found:
            raise ValueError(f"建筑表第 {n} 行重复 ID {key}")
        amounts = [integer(v, f"建筑表第 {n} 行 {m}") for m, v in zip(MATERIALS, row[start:end])]
        found[key] = {m: v for m, v in zip(MATERIALS, amounts) if v}
    check_keys(found, expected, "建筑 ID")
    return {k: found[k] for k in expected}


def harvest(path):
    table = rows(path)
    values = {}

    def add(key, cell):
        if key in values:
            raise ValueError(f"资源表重复参数 {key}")
        values[key] = integer(cell, key, 1)

    if table and table[0] == ["key", "value"]:
        for row in table[1:]:
            if any(row):
                if len(row) != 2:
                    raise ValueError("资源精简表每行须有 key,value 两列")
                add(*row)
    else:
        if len(table) < 2 or len(table[1]) < 12:
            raise ValueError("资源 CSV 需要 key,value，或第 2 行为表头的飞书 B、J～L 列")
        for row in table[2:]:
            key = row[1] if len(row) > 1 else ""
            if key == "wood":
                add("woodPerTrunkLevel", row[9] if len(row) > 9 else "")
            if key in ("stone", "pigIron"):
                for i, field in [(10, "reserve"), (11, "batch")]:
                    add(f"{key}.{field}", row[i] if len(row) > i else "")
    check_keys(values, PARAMETERS, "采集参数")
    return values


def save_csv(path, contents):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        csv.writer(stream).writerows(contents)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["export", "check", "import"])
    parser.add_argument("buildings", type=Path)
    parser.add_argument("resources", type=Path)
    args = parser.parse_args()
    current = json.loads(CONFIG.read_text(encoding="utf-8"))
    costs = current["buildingCosts"]
    if args.mode == "export":
        if args.buildings.resolve() == args.resources.resolve():
            raise ValueError("两份 CSV 需要不同文件名")
        save_csv(args.buildings, [["id", *MATERIALS]] + [
            [key, *[cost.get(m, 0) for m in MATERIALS]] for key, cost in costs.items()
        ])
        save_csv(args.resources, [["key", "value"], ["woodPerTrunkLevel", current["woodPerTrunkLevel"]]] + [
            [f"{r}.{k}", v] for r, fields in current["deposits"].items() for k, v in fields.items()
        ])
        return
    updated = building_costs(args.buildings, costs)
    params = harvest(args.resources)
    result = dict(buildingCosts=updated, woodPerTrunkLevel=params["woodPerTrunkLevel"],
                  deposits={r: {f: params[f"{r}.{f}"] for f in ("reserve", "batch")} for r in ("stone", "pigIron")})
    print(f"{len(updated)} buildings, {len(params)} parameters. Matches current config: {result == current}")
    if args.mode == "import" and result != current:
        # Keep one building per line so planners can review exactly what changed.
        entries = ",\n".join(f'    "{key}": {json.dumps(cost)}' for key, cost in updated.items())
        rest = json.dumps({k: v for k, v in result.items() if k != "buildingCosts"}, indent=2)
        with NamedTemporaryFile("w", encoding="utf-8", dir=CONFIG.parent, delete=False) as tmp:
            tmp.write('{\n  "buildingCosts": {\n' + entries + '\n  },' + rest[1:] + '\n')
        Path(tmp.name).replace(CONFIG)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, csv.Error, OSError) as error:
        raise SystemExit(str(error))
