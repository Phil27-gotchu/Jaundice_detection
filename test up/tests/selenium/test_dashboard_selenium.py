"""Selenium UI suite: SEL-01 to SEL-20.

The test acts as the ESP by POSTing to the API; Chrome only reads the dashboard.
Each test gets a fresh server (see conftest.py).
"""
import re

from helpers import (
    BASE, body_bg, body_text, click_refresh, get_theme, heartbeat, js_class,
    js_count, js_href, js_text, post_reading, toggle_theme, wait, wait_count,
    wait_text, theme_snapshot, theme_markers_changed, theme_colours_changed,
)


# ---------------------------------------------------------------- static UI
def test_SEL01_page_title(page):
    assert "jaundice" in (page.title + body_text(page)).lower()


def test_SEL02_heading_is_present(page):
    assert js_text(page, "h1, h2"), "no heading text found"


def test_SEL03_metric_labels_present(page):
    text = body_text(page)
    assert re.search(r"b\s*/\s*g", text), "B/G label missing"
    assert re.search(r"b\s*/\s*r", text), "B/R label missing"
    assert re.search(r"\bod\b", text), "OD label missing"


def test_SEL04_table_headers(page):
    assert js_count(page, "table th") >= 7


# ------------------------------------------------------------- empty / data
def test_SEL05_empty_server_shows_waiting_state(page):
    wait(page, lambda d: "waiting for device" in body_text(d), 8)
    assert js_text(page, "#sampleCount") == "0"


def test_SEL06_new_reading_appears_by_auto_poll(page):
    post_reading(odDiff=0.32, bgRatio=0.72, brRatio=0.59)
    wait(page, lambda d: "0.3200" in body_text(d), 10, "OD 0.3200 never appeared")
    text = body_text(page)
    assert "0.7200" in text and "0.5900" in text


def test_SEL07_refresh_button_shows_reading(page):
    post_reading(odDiff=0.32, bgRatio=0.72, brRatio=0.59)
    click_refresh(page)
    wait(page, lambda d: "0.3200" in body_text(d), 8, "OD 0.3200 never appeared")


def test_SEL08_three_readings_three_rows(page):
    for i in range(3):
        post_reading(r=1000 + i)
    click_refresh(page)
    wait_text(page, "#sampleCount", "3")
    wait_count(page, "#readingsBody tr", 3)


def test_SEL09_table_shows_one_row_per_reading(page):
    for i in range(5):
        post_reading(r=1000 + i)
    click_refresh(page)
    wait_text(page, "#sampleCount", "5")
    wait_count(page, "#readingsBody tr", 5)


def test_SEL10_chart_has_five_series_and_one_hover_column_per_reading(page):
    for i in range(4):
        post_reading(r=1000 + i)
    click_refresh(page)
    wait_count(page, ".chart-wrap svg .hover-col", 4)
    for cls in ("series-r", "series-g", "series-b", "series-ratio", "series-od"):
        assert js_count(page, f".chart-wrap svg path.{cls}") >= 1, cls


# ----------------------------------------------------- device / online state
def test_SEL11_device_id_shown(page):
    post_reading(deviceId="probe-42")
    click_refresh(page)
    wait_text(page, "#deviceId", "probe-42")


def test_SEL12_heartbeat_makes_device_online(page):
    heartbeat()
    wait(page, lambda d: "is-online" in js_class(d, "#onlineLabel"), 10,
         "device never shown as online")
    assert "online" in (js_text(page, "#onlineLabel") or "").lower()


def test_SEL13_device_goes_offline_after_timeout(page):
    heartbeat()
    wait(page, lambda d: "is-online" in js_class(d, "#onlineLabel"), 10)
    wait(page, lambda d: "is-online" not in js_class(d, "#onlineLabel"), 45,
         "device never went offline after the heartbeat timeout")


# ------------------------------------------------------------------- theme
def test_SEL14_theme_toggle_changes_theme(page):
    before = theme_snapshot(page)
    toggle_theme(page)
    wait(page, lambda d: (
        theme_markers_changed(before, theme_snapshot(d)) or
        theme_colours_changed(before, theme_snapshot(d))
    ), 8, "theme toggle changed neither theme markers nor computed colours")


def test_SEL15_theme_is_saved_in_local_storage(page):
    toggle_theme(page)
    wait(page, lambda d: d.execute_script(
        "return Object.keys(localStorage).some(function(k){"
        " return /dark|light/.test(localStorage.getItem(k) || ''); });"), 5,
        "theme not found in localStorage")


def test_SEL16_theme_survives_refresh(page):
    toggle_theme(page)
    wait(page, lambda d: get_theme(d) is not None, 5)
    chosen = get_theme(page)
    page.refresh()
    wait(page, lambda d: js_count(d, "#refreshBtn") == 1, 10)
    wait(page, lambda d: get_theme(d) == chosen, 5,
         f"theme was {get_theme(page)!r} after refresh, expected {chosen!r}")


def test_SEL17_theme_colours_differ(page):
    before = theme_snapshot(page)
    toggle_theme(page)
    wait(page, lambda d: theme_colours_changed(before, theme_snapshot(d)), 8,
         "no visible container's computed colours changed after theme toggle")


# ------------------------------------------------------ export / XSS / down
def test_SEL18_export_csv_link(page):
    href = js_href(page, 'a[href*="export.csv"]')
    assert href and href.endswith("/api/export.csv"), href


def test_SEL19_xss_payload_is_shown_as_text(page):
    payload = "<img src=x onerror=alert(1)>"
    post_reading(deviceId=payload)
    click_refresh(page)
    wait_text(page, "#deviceId", payload)
    assert js_count(page, "#deviceId img") == 0
    assert js_count(page, "#readingsBody img") == 0


def test_SEL20_server_stopped_shows_unreachable(page, server):
    post_reading()
    click_refresh(page)
    wait_text(page, "#sampleCount", "1")
    server.stop()
    wait(page, lambda d: "unreachable" in body_text(d), 20,
         "no 'unreachable' label after the server stopped")
