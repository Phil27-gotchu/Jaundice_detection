import os
import pathlib
import subprocess
import time
import urllib.request

import pytest
from selenium import webdriver
<<<<<<< HEAD
from selenium.webdriver.edge.options import Options

from helpers import API_KEY, BASE, PORT, wait, js_count


ROOT = pathlib.Path(__file__).resolve().parents[2]
=======
from selenium.webdriver.chrome.options import Options

from helpers import API_KEY, BASE, PORT, wait, js_count

ROOT = pathlib.Path(__file__).resolve().parents[2]  # project root
>>>>>>> 66891b8 (update)


class Server:
    def __init__(self):
        env = dict(os.environ, PORT=str(PORT), API_KEY=API_KEY)
<<<<<<< HEAD

        self.proc = subprocess.Popen(
            ["node", "server/index.js"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        deadline = time.time() + 15

        while time.time() < deadline:
            try:
                with urllib.request.urlopen(
                    BASE + "/api/health", timeout=1
                ):
                    return
            except Exception:
                time.sleep(0.2)

        self.stop()
        raise RuntimeError(
            f"Server did not start on port {PORT} "
            "(is it already in use?)"
        )
=======
        self.proc = subprocess.Popen(
            ["node", "server/index.js"], cwd=ROOT, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(BASE + "/api/health", timeout=1):
                    return
            except Exception:
                time.sleep(0.2)
        self.stop()
        raise RuntimeError(f"Server did not start on port {PORT} (is it already in use?)")
>>>>>>> 66891b8 (update)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
<<<<<<< HEAD

=======
>>>>>>> 66891b8 (update)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


@pytest.fixture
def server():
<<<<<<< HEAD
    """Start a fresh server for each test."""
    s = Server()
    try:
        yield s
    finally:
        s.stop()
=======
    """A fresh server (empty store, no device status) for every test."""
    s = Server()
    yield s
    s.stop()
>>>>>>> 66891b8 (update)


@pytest.fixture
def page(server):
    opts = Options()
<<<<<<< HEAD

    if not os.environ.get("HEADED"):
        opts.add_argument("--headless=new")

    opts.add_argument("--window-size=1400,1000")

    driver = webdriver.Edge(options=opts)

    try:
        driver.get(BASE + "/")
        wait(
            driver,
            lambda d: js_count(d, "#refreshBtn") == 1,
            15,
            "dashboard did not load",
        )
        yield driver
    finally:
        driver.quit()
=======
    if not os.environ.get("HEADED"):
        opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1400,1000")
    opts.add_argument("--no-sandbox")
    driver = webdriver.Chrome(options=opts)
    driver.get(BASE + "/")
    wait(driver, lambda d: js_count(d, "#refreshBtn") == 1, 15, "dashboard did not load")
    yield driver
    driver.quit()
>>>>>>> 66891b8 (update)
