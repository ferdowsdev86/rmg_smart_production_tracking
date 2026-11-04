"""Unit tests for the pure line balancer (no DB needed)."""

import pytest

from line_planner.balancer import balance_line


def _ops():
    # 6 operations, two pairs of tiny same-type ops that should combine
    return [
        {"seq": 1, "operation_name": "A small", "machine_type": "SNLS", "smv": 0.20},
        {"seq": 2, "operation_name": "A small 2", "machine_type": "SNLS", "smv": 0.20},
        {"seq": 3, "operation_name": "Overlock big", "machine_type": "OL-4T", "smv": 0.90},
        {"seq": 4, "operation_name": "Flatlock", "machine_type": "FL", "smv": 0.50},
        {"seq": 5, "operation_name": "Button hole", "machine_type": "BH", "smv": 0.15},
        {"seq": 6, "operation_name": "Button sew", "machine_type": "BS", "smv": 0.15},
    ]


def test_total_smv_and_takt():
    r = balance_line(_ops(), manpower=6, efficiency=0.6, working_hours=8)
    assert r["total_smv"] == pytest.approx(2.10, abs=1e-6)
    # target/hr = 6*60*0.6/2.10 ; takt = 60/target
    assert r["target_per_hour"] == pytest.approx(102.86, abs=0.1)
    assert r["takt_time"] == pytest.approx(60 / r["target_per_hour"], abs=1e-3)


def test_manpower_is_respected():
    r = balance_line(_ops(), manpower=6)
    assert r["manpower_used"] == 6
    assert sum(s["operator_count"] for s in r["stations"]) == 6


def test_adjacent_same_type_small_ops_combine():
    # the two SNLS 0.20 ops are adjacent and tiny -> one station
    r = balance_line(_ops(), manpower=8)
    snls = [s for s in r["stations"] if s["machine_type"] == "SNLS"]
    assert len(snls) == 1
    assert len(snls[0]["operations"]) == 2


def test_different_type_ops_do_not_combine():
    r = balance_line(_ops(), manpower=8)
    # BH and BS are different types even though both tiny and adjacent
    types = [s["machine_type"] for s in r["stations"]]
    assert "BH" in types and "BS" in types


def test_sequence_order_preserved():
    r = balance_line(_ops(), manpower=8)
    nos = [s["station_no"] for s in r["stations"]]
    assert nos == sorted(nos)
    first_ops = r["stations"][0]["operations"]
    assert first_ops[0]["seq"] == 1


def test_balance_pct_and_bottleneck():
    r = balance_line(_ops(), manpower=6)
    assert 0 < r["balance_pct"] <= 100
    assert r["bottleneck_station"] is not None
    bottleneck = [s for s in r["stations"] if s["is_bottleneck"]]
    assert len(bottleneck) == 1
    # bottleneck has the max per-operator load
    assert bottleneck[0]["smv_load"] == max(s["smv_load"] for s in r["stations"])


def test_target_per_hour_input_path():
    r = balance_line(_ops(), target_per_hour=120, working_hours=10)
    assert r["target_per_hour"] == 120
    assert r["takt_time"] == pytest.approx(0.5, abs=1e-6)
    assert r["day_target"] == 1200


def test_machine_requirement_sums_operators():
    r = balance_line(_ops(), manpower=6)
    assert sum(r["machine_requirement"].values()) == 6


def test_requires_manpower_or_target():
    with pytest.raises(ValueError):
        balance_line(_ops())


def test_zero_smv_raises():
    with pytest.raises(ValueError):
        balance_line([{"seq": 1, "operation_name": "x", "machine_type": "SNLS", "smv": 0}], manpower=4)
