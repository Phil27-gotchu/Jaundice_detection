"""Helpers for the Selenium suite.

Rule used everywhere: never hold a WebElement. Every read or click is ONE
execute_script call, so a dashboard re-render (every 2 s) cannot make it stale.
"""
import json
import os
import urllib.error
import urllib.request

from selenium.common.exceptions import WebDriverException
from selenium.webdriver.support.ui import WebDriverWait

PORT = 3100
BASE = f"http://127.0.0.1:{PORT}"
API_KEY = os.environ.get("API_KEY", "CHANGE_ME")


# ------------------------------------------------------------------ HTTP
def call(method, path, body=None, key=True):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-API-Key"] = API_KEY
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def post_reading(**over):
    body = {
        "deviceId": "probe-1",
        "r": 120, "g": 150, "b": 100,
        "bgRatio": 0.6667, "brRatio": 0.8333, "odDiff": 0.4,
    }
    body.update(over)
    status = call("POST", "/api/readings", body)
    assert status == 200, (
        f"POST /api/readings returned {status}. If 401, set API_KEY to the key "
        "your server expects (see README / server/index.js)."
    )


def heartbeat(device_id="esp32-probe-1"):
    status = call("POST", "/api/heartbeat", {"deviceId": device_id})
    assert status == 200, f"POST /api/heartbeat returned {status}"


# --------------------------------------------------------- browser reads
def wait(driver, condition, timeout=10, message=""):
    """Poll `condition(driver)`; browser errors during a re-render are retried."""
    return WebDriverWait(
        driver, timeout, ignored_exceptions=(WebDriverException,)
    ).until(condition, message=message)


def js_text(d, css):
    return d.execute_script(
        "var e = document.querySelector(arguments[0]);"
        "return e ? e.innerText.trim() : null;", css)


def js_count(d, css):
    return d.execute_script(
        "return document.querySelectorAll(arguments[0]).length;", css)


def js_class(d, css):
    return d.execute_script(
        "var e = document.querySelector(arguments[0]);"
        "return e ? e.className : '';", css)


def js_href(d, css):
    return d.execute_script(
        "var e = document.querySelector(arguments[0]);"
        "return e ? e.getAttribute('href') : null;", css)


def body_text(d):
    return d.execute_script("return document.body.innerText;").lower()


def click_refresh(d):
    d.execute_script("document.getElementById('refreshBtn').click();")


def wait_text(d, css, expected, timeout=8):
    wait(d, lambda x: expected in (js_text(x, css) or ""), timeout,
         f"{css!r} never contained {expected!r}")


def wait_count(d, css, n, timeout=8):
    wait(d, lambda x: js_count(x, css) == n, timeout,
         f"{css!r} never reached {n} elements (last: {js_count(d, css)})")


# ----------------------------------------------------------------- theme
_THEME_BTN = (
    "document.querySelector('#themeToggle, #themeBtn, #theme-toggle, "
    "[data-theme-toggle], button[id*=\"theme\" i], "
    "button[aria-label*=\"theme\" i], button[class*=\"theme\" i]')"
)


def get_theme(d):
    return d.execute_script(
        "return document.documentElement.getAttribute('data-theme')"
        " || (document.body && document.body.getAttribute('data-theme')) || null;")


def toggle_theme(d):
    clicked = d.execute_script(
        f"var b = {_THEME_BTN}; if (!b) return false; b.click(); return true;")
    assert clicked, "theme toggle button not found - check its id/class in index.html"


def body_bg(d):
    return d.execute_script("return getComputedStyle(document.body).backgroundColor;")
