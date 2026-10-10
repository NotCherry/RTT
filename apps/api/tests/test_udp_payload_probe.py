from tools.udp_payload_probe import probe


def test_probe_verifies_exact_small_payloads_without_a_remote_peer():
    result = probe(sizes=(64, 512), timeout=.5)
    assert result["result"] == "passed"
    assert all(row["received"] == 3 for row in result["samples"])
