"""Drives the real application in a real browser, start to finish, through every role.
Starts the server on an empty database (no seed) and uses only what a person could click."""
import os, sys, time, json, base64, tempfile, subprocess, pathlib, shutil
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = pathlib.Path(os.environ.get("SHOTS", tempfile.mkdtemp(prefix="eo-shots-")))
SHOTS.mkdir(parents=True, exist_ok=True)
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
DATA = tempfile.mkdtemp(prefix="eo-ui-")
PORT = os.environ.get("PORT", "8898")
BASE = f"http://127.0.0.1:{PORT}"
PW = "Str0ngPassw0rd"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
PNGFILE = pathlib.Path(DATA) / "leak.png"; PNGFILE.write_bytes(PNG)

passed = failed = 0
def ok(what, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print("  PASS ", what)
    else: failed += 1; print("  FAIL ", what, extra)
    return cond

srv = subprocess.Popen(["node", "server.js"], cwd=str(ROOT),
    env={"PORT": PORT, "DATA_DIR": DATA, "PATH": os.environ["PATH"], "HOME": "/root", "LOG_REQUESTS": "0"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)

errors = []
def watch(page, who):
    page.on("pageerror", lambda e: errors.append(f"{who}: {e}"))
    page.on("console", lambda m: errors.append(f"{who}: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text and "ERR_" not in m.text else None)

def nav_labels(page):
    page.wait_for_selector("#nav a")
    return page.eval_on_selector_all("#nav a .lbl", "e=>e.map(x=>x.innerText.trim())")

def goto(page, hash_):
    page.evaluate(f"location.hash = '{hash_}'"); page.wait_for_timeout(700)

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path=CHROME)
        def ctx(w=1360, h=900):
            c = br.new_context(viewport={"width": w, "height": h}); p = c.new_page(); return c, p

        # ---------------------------------------------------------------- setup
        print("\n== First run: create the organization ==")
        c_m, m = ctx(); watch(m, "manager")
        m.goto(BASE + "/index.html")
        ok("landing page has the product headline", "Rental Maintenance, Managed in One Place" in m.inner_text("h1"))
        for label in ["Get Started", "Sign In", "Learn How It Works"]:
            ok(f"landing page offers '{label}'", m.locator(f"a:has-text('{label}')").count() >= 1)
        body = m.inner_text("body").lower()
        ok("landing page shows no demo credentials", "password123" not in body and "@estateops.test" not in body)
        m.screenshot(path=str(SHOTS / "landing.png"), full_page=True)
        m.goto(BASE + "/login.html"); m.wait_for_selector("#orgRow:not([hidden])")
        ok("a new installation asks for the first manager", "Set up EstateOps" in m.inner_text("#title"))
        ok("there are no role buttons that sign in to a preset account", m.locator("button:has-text('Try it as')").count() == 0 and m.locator(".demo").count() == 0)
        m.fill("#org", "Harbour Estates"); m.fill("#name", "Hana Admin"); m.fill("#email", "hana@harbour.test"); m.fill("#pw", PW)
        m.click("#submit"); m.wait_for_url("**/app.html**")
        m.wait_for_selector(".stats")
        ok("manager lands on their own dashboard", nav_labels(m) == ["Overview", "Requests", "Properties", "People", "Vendors", "Insights", "Activity", "Notifications", "Account"], nav_labels(m))
        ok("empty install shows a getting-started guide, not fake numbers", "Get started" in m.inner_text("#panes") and "Open requests" in m.inner_text("#panes"))
        ok("all dashboard figures start at zero", m.eval_on_selector_all(".stat .v", "e=>e.slice(0,4).map(x=>x.innerText)") == ["0", "0", "0", "0"])
        m.screenshot(path=str(SHOTS / "manager-empty.png"))

        # ---------------------------------------------------------------- properties, vendor, invitations
        print("\n== Manager builds the portfolio and invites people ==")
        goto(m, "#/properties"); m.wait_for_selector("#propForm")
        ok("empty properties page explains what to do", "No properties yet" in m.inner_text("#panes"))
        m.fill("#pName", "Harbour View"); m.fill("#pAddr", "1 Quay Road"); m.click("#propForm button[type=submit]")
        m.wait_for_selector("#unitForm")
        m.fill("#uLabel", "12A"); m.click("#unitForm button[type=submit]"); m.wait_for_selector("td.strong:has-text('12A')")
        ok("property and unit were saved and listed", True)
        m.fill("#uLabel", "12a"); m.click("#unitForm button[type=submit]"); m.wait_for_timeout(500)
        ok("a duplicate unit label is refused with a message", "already exists" in m.inner_text("#uErr"))

        goto(m, "#/vendors"); m.wait_for_selector("#vendorForm")
        m.fill("#vName", "FixIt Plumbing"); m.fill("#vEmail", "office@fixit.test"); m.check("#vCats input[value=PLUMBING]")
        m.click("#vendorForm button[type=submit]"); m.wait_for_selector("select.vstatus")
        ok("a new vendor is added as Pending", m.input_value("select.vstatus") == "PENDING")
        m.select_option("select.vstatus", "ACTIVE"); m.wait_for_timeout(800)
        m.wait_for_selector("select.vstatus")
        ok("manager approves the vendor (Active)", m.input_value("select.vstatus") == "ACTIVE")
        m.click("button:has-text('Invite staff')"); m.wait_for_selector("#inviteForm")
        ok("'Invite staff' opens the invite form for that vendor", m.input_value("#iRole") == "VENDOR" and m.input_value("#iVendor") != "")
        links = {}
        def invite(email, role, unit=False):
            m.select_option("#iRole", role)
            if unit: m.select_option("#iUnit", index=1)
            m.fill("#iEmail", email); m.click("#inviteForm button[type=submit]")
            m.wait_for_selector("#iResult .linkbox code")
            links[role] = m.inner_text("#iResult .linkbox code").strip()
        invite("kira@fixit.test", "VENDOR")
        invite("tom@harbour.test", "TECHNICIAN")
        invite("tara@harbour.test", "TENANT", unit=True)
        ok("three invitation links were produced", len(links) == 3 and all("/accept.html?token=" in v for v in links.values()), links)
        m.reload(); m.wait_for_selector("#inviteForm")
        ok("pending invitations are listed, with no token shown", m.locator("td:has-text('kira@fixit.test')").count() == 1 and "token=" not in m.inner_text("#panes"))
        m.screenshot(path=str(SHOTS / "manager-people.png"), full_page=True)

        # ---------------------------------------------------------------- tenant onboarding + report
        print("\n== Tenant accepts the invitation and reports an issue ==")
        c_t, t = ctx(); watch(t, "tenant")
        t.goto(links["TENANT"]); t.wait_for_selector("#form:not([hidden])")
        ok("invitation page shows who and what", "Harbour Estates" in t.inner_text("#facts") and "12A" in t.inner_text("#facts"))
        t.fill("#name", "Tara Tenant"); t.fill("#pw", PW); t.click("#submit"); t.wait_for_url("**/app.html**"); t.wait_for_selector(".stats")
        ok("tenant sees only tenant navigation", nav_labels(t) == ["Overview", "Report an issue", "My requests", "Notifications", "Account"], nav_labels(t))
        ok("tenant dashboard lists their unit", "12A" in t.inner_text("#panes"))
        goto(t, "#/report"); t.wait_for_selector("#reportForm")
        t.click("#reportForm button[type=submit]"); t.wait_for_timeout(300)
        ok("an empty report is refused with guidance", "short title" in t.inner_text("#rErr"))
        t.fill("#rTitle", "Kitchen tap leaking"); t.fill("#rDesc", "Water runs from the base of the tap."); t.select_option("#rCat", "PLUMBING"); t.select_option("#rPri", "HIGH")
        t.set_input_files("#rFile", str(PNGFILE)); t.click("#reportForm button[type=submit]")
        t.wait_for_selector(".file img", timeout=8000)
        ok("the report was saved and the uploaded photo displays", t.locator(".file img").count() == 1 and "Kitchen tap leaking" in t.inner_text("#panes"))
        ok("the tenant is offered no manager actions and sees no cost", t.locator("button:has-text('Close request')").count() == 0 and "Cost" not in t.inner_text("#panes") and t.locator("#assignForm").count() == 0)
        t.fill("#cmBody", "It is getting worse."); t.click("#commentForm button[type=submit]"); t.wait_for_selector(".cmt")
        ok("a comment posts and stays", "getting worse" in t.inner_text("#panes"))
        t.screenshot(path=str(SHOTS / "tenant-request.png"), full_page=True)
        tenant_token = json.loads(t.evaluate("localStorage.getItem('eo_auth')"))["token"]
        goto(t, "#/people")
        ok("typing a manager-only address sends the tenant back to their overview", t.evaluate("location.hash") == "#/overview")
        status = t.evaluate("""fetch('/api/vendors',{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('eo_auth')).token}}).then(r=>r.status)""")
        ok("and the server refuses the same call anyway (403)", status == 403, status)

        # ---------------------------------------------------------------- manager triage, AI, assign to vendor
        print("\n== Manager reviews and assigns to the vendor ==")
        goto(m, "#/overview"); m.wait_for_selector(".stats")
        ok("manager dashboard now counts the new request", m.eval_on_selector_all(".stat .v", "e=>e[0].innerText") == "1")
        goto(m, "#/requests"); m.wait_for_selector("tr.clickable")
        m.fill("#fq", "nothing like this"); m.wait_for_selector("text=No matching requests")
        ok("search with no match shows an empty state", True)
        m.fill("#fq", "tap"); m.wait_for_selector("tr.clickable")
        ok("search finds the request", m.locator("tr.clickable").count() == 1)
        m.click("tr.clickable"); m.wait_for_selector("#assignForm")
        m.click("button:has-text('Suggest category and priority')"); m.wait_for_selector("#aiErr:not(:empty)")
        ok("without a key the AI panel says so plainly", "not set up" in m.inner_text("#aiErr").lower(), m.inner_text("#aiErr"))
        m.click("button:has-text('Start review')"); m.wait_for_selector("text=Under review")
        m.wait_for_selector("#assignForm")
        m.fill("#aDue", "2030-05-01")
        m.select_option("#aWho", label="FixIt Plumbing — Plumbing"); m.click("#assignForm button[type=submit]")
        m.wait_for_selector("dd:has-text('FixIt Plumbing (vendor)')")
        ok("the request is assigned to the vendor and moved to Assigned", "Assigned" in m.inner_text(".panel-body .row"))
        m.screenshot(path=str(SHOTS / "manager-request.png"), full_page=True)

        # ---------------------------------------------------------------- vendor
        print("\n== Vendor accepts, quotes, works, invoices ==")
        c_v, v = ctx(); watch(v, "vendor")
        v.goto(links["VENDOR"]); v.wait_for_selector("#form:not([hidden])")
        ok("the vendor invitation names the company", "FixIt Plumbing" in v.inner_text("#facts"))
        v.fill("#name", "Kira Fixit"); v.fill("#pw", PW); v.click("#submit"); v.wait_for_url("**/app.html**"); v.wait_for_selector(".stats")
        ok("vendor sees only vendor navigation", nav_labels(v) == ["Overview", "Work orders", "Company", "Notifications", "Account"], nav_labels(v))
        goto(v, "#/requests"); v.wait_for_selector("tr.clickable")
        ok("the vendor's work order list holds exactly the assigned job", v.locator("tr.clickable").count() == 1)
        v.click("tr.clickable"); v.wait_for_selector("#quoteForm")
        ok("the vendor sees the job but no manager controls", v.locator("#assignForm").count() == 0 and v.locator("button:has-text('Close request')").count() == 0 and v.locator("text=AI suggestion").count() == 0)
        v.fill("#qAmt", "1800"); v.fill("#qDesc", "Replace cartridge and washers."); v.click("#quoteForm button[type=submit]")
        v.wait_for_selector("td:has-text('Pending')")
        ok("the quotation is submitted and shown as pending", True)

        m.reload(); m.wait_for_selector("button[data-act=quote]")
        m.click("button[data-act=quote][data-d=APPROVE]"); m.wait_for_selector("td:has-text('Approved')")
        ok("the manager approves the quotation", True)

        v.reload(); v.wait_for_selector("button:has-text('Start work')")
        v.click("button:has-text('Start work')"); v.wait_for_selector("button:has-text('Mark work complete')")
        v.click("button:has-text('Mark work complete')"); v.fill("#cNotes", "Cartridge replaced; no leaks."); v.click("#completeForm button[type=submit]")
        v.wait_for_selector("dt:has-text('COMPLETION')")
        ok("completion notes were saved on the request", "no leaks" in v.inner_text("#panes"))
        v.set_input_files("#fFile", str(PNGFILE)); v.click("#fileForm button[type=submit]"); v.wait_for_selector(".file:has-text('Evidence')")
        ok("completion evidence was uploaded", True)
        v.fill("#eAmt", "1750"); v.fill("#eDesc", "Invoice 0042"); v.click("#expForm button[type=submit]"); v.wait_for_selector("td:has-text('Awaiting approval')")
        ok("the vendor's invoice is recorded and awaits approval", "Invoice" in v.inner_text("#panes"))
        ok("the vendor has no Approve button for its own invoice", v.locator("button:has-text('Approve')").count() == 0)
        v.screenshot(path=str(SHOTS / "vendor-request.png"), full_page=True)

        m.reload(); m.wait_for_selector("button[data-act=approve]")
        m.click("button[data-act=approve]"); m.wait_for_selector("span.chip:has-text('Approved')")
        m.click("button:has-text('Close request')"); m.wait_for_selector(".row .chip:has-text('Closed')")
        ok("manager approves the invoice and closes the request", True)
        goto(m, "#/overview"); m.wait_for_selector(".stats")
        vals = m.eval_on_selector_all(".stat", "e=>e.map(x=>[x.querySelector('.k').innerText, x.querySelector('.v').innerText])")
        spend = dict(vals).get("Approved spend, 30 days", "")
        ok("the dashboard spend now shows the approved invoice, computed from the database", "1,750" in spend, spend)
        goto(m, "#/insights"); m.wait_for_selector("text=AI suggestions")
        goto(m, "#/activity"); m.wait_for_selector("table.data")
        ok("the activity log lists the approvals and assignments", all(x in m.inner_text("#panes") for x in ["Expense approved", "Request assigned", "Invoice recorded"]), m.inner_text("#panes")[:300])

        # ---------------------------------------------------------------- tenant sees outcome
        goto(t, "#/request/1"); t.wait_for_selector(".row .chip")
        ok("the tenant sees the request is closed, and still no cost", "Closed" in t.inner_text(".row") and "Approved" not in t.inner_text("#panes"))
        goto(t, "#/notifications"); t.wait_for_selector("ul.tl li")
        ok("the tenant has real notifications about their request", t.locator("ul.tl li").count() >= 3)

        # ---------------------------------------------------------------- technician
        print("\n== Technician onboarding ==")
        c_k, k = ctx(); watch(k, "technician")
        k.goto(links["TECHNICIAN"]); k.wait_for_selector("#skillsRow:not([hidden])")
        k.fill("#name", "Tom Tech"); k.fill("#skills", "Electrical"); k.fill("#pw", PW); k.click("#submit"); k.wait_for_url("**/app.html**"); k.wait_for_selector(".stats")
        ok("technician sees only technician navigation", nav_labels(k) == ["Overview", "My jobs", "Notifications", "Account"], nav_labels(k))
        goto(k, "#/requests"); k.wait_for_selector(".empty")
        ok("a technician with no assignments sees an empty list, not other people's jobs", "Nothing here yet" in k.inner_text("#panes"))
        status = k.evaluate("""fetch('/api/maintenance-requests/1',{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('eo_auth')).token}}).then(r=>r.status)""")
        ok("the technician cannot fetch another person's request by id (403)", status == 403, status)
        goto(k, "#/account"); k.wait_for_selector("#profileForm")
        ok("the technician's skills from onboarding are on their profile", k.input_value("#aSkills") == "Electrical")

        # ---------------------------------------------------------------- sessions
        print("\n== Sign out ends every session ==")
        t.click("#logout"); t.wait_for_url("**/login.html")
        code = m.evaluate("""t=>fetch('/api/auth/me',{headers:{Authorization:'Bearer '+t}}).then(r=>r.status)""", tenant_token)
        ok("after sign-out the old token is rejected by the server", code == 401, code)
        t.goto(BASE + "/app.html"); t.wait_for_url("**/login.html")
        ok("opening the app without a session goes to sign-in", True)
        t.fill("#email", "tara@harbour.test"); t.fill("#pw", "wrong-wrong"); t.click("#submit"); t.wait_for_timeout(600)
        ok("a wrong password shows a clear message", "Wrong email or password" in t.inner_text("#err"))

        # ---------------------------------------------------------------- mobile
        print("\n== Mobile layout ==")
        for who, page, hash_ in [("manager", m, "#/overview"), ("vendor", v, "#/overview"), ("technician", k, "#/overview")]:
            page.set_viewport_size({"width": 390, "height": 800}); goto(page, hash_); page.wait_for_timeout(500)
            overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2")
            ok(f"{who} dashboard has no horizontal scrolling on a phone", not overflow)
            page.screenshot(path=str(SHOTS / f"mobile-{who}.png"))
        c2, t2 = ctx(390, 800); t2.goto(BASE + "/login.html"); t2.wait_for_timeout(500)
        ok("login page fits a phone", not t2.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2"))
        t2.screenshot(path=str(SHOTS / "mobile-login.png"))
        t2.goto(BASE + "/index.html"); t2.wait_for_timeout(400)
        ok("landing page fits a phone", not t2.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2"))

        ok("no JavaScript errors anywhere in the journey", not errors, errors[:5])
        br.close()
finally:
    srv.terminate()
    shutil.rmtree(DATA, ignore_errors=True)
print(f"\nUI: {passed} passed, {failed} failed   (screenshots: {SHOTS})")
sys.exit(1 if failed else 0)
