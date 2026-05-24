"""Browser test: compile a .viv file via Pyodide/WASM and verify the output."""

import json
import sys
from playwright.sync_api import sync_playwright

CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PAGE_URL = "http://localhost:8080/wasm/index.html"
PYODIDE_TIMEOUT_MS = 180_000  # 3 min: Pyodide is large, CDN download can be slow


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROMIUM_PATH,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = browser.new_context()
        page = context.new_page()

        # Capture console output for debugging
        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: logs.append(f"[PAGE ERROR] {err}"))

        print("Opening page…")
        page.goto(PAGE_URL, timeout=30_000)
        print(f"Page title: {page.title()}")

        # Wait until Pyodide has loaded the compiler and the button is enabled
        print("Waiting for compiler to load (may take a minute)…")
        page.wait_for_function(
            "() => !document.getElementById('compileBtn').disabled",
            timeout=PYODIDE_TIMEOUT_MS,
        )
        print("Compiler ready.")

        # Click compile
        page.locator("#compileBtn").click()

        # Wait for the output div to gain class "success"
        page.wait_for_function(
            "() => document.getElementById('output').classList.contains('success')",
            timeout=30_000,
        )

        output_text = page.locator("#output").text_content()
        print("\n--- Compiled output (first 200 chars) ---")
        print(output_text[:200])
        print("…")

        # Validate it's real JSON with expected structure
        bundle = json.loads(output_text)
        assert "actions" in bundle, "Expected 'actions' key in bundle"
        assert "hello" in bundle["actions"], "Expected 'hello' action in bundle"
        action = bundle["actions"]["hello"]
        assert action["roles"]["greeter"]["participationMode"] == "initiator"
        assert action["roles"]["friend"]["participationMode"] == "recipient"
        print("\nAll assertions passed.")

        # Take a screenshot for visual confirmation
        import os
        out_dir = os.path.dirname(os.path.abspath(__file__))
        screenshot_path = os.path.join(out_dir, "screenshot.png")
        page.screenshot(path=screenshot_path, full_page=True)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

    if any("[PAGE ERROR]" in l or "[error]" in l for l in logs):
        print("\nConsole errors:")
        for l in logs:
            if "[PAGE ERROR]" in l or "[error]" in l:
                print(" ", l)

    return 0


if __name__ == "__main__":
    sys.exit(main())
