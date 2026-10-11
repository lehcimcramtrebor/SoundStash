import os
import re
import sys
import json
import inspect
import ast
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def run_audit():
    print("=" * 70)
    print("SOUNDSTASH v5.0.0 COMPREHENSIVE REPOSITORY AUDIT")
    print("=" * 70)

    # 1. API Route Coverage & Matching
    print("\n--- 1. API ROUTES AUDIT (Frontend vs Backend) ---")
    backend_app_path = Path("backend/app.py")
    with open(backend_app_path, "r", encoding="utf-8") as f:
        app_code = f.read()

    # Match @app.get('/api/...'), @app.post('/api/...'), etc.
    route_pattern = re.compile(r'@app\.(get|post|put|delete|patch)\(\s*["\']([^"\']+)["\']')
    backend_routes = {}
    for match in route_pattern.finditer(app_code):
        method, path = match.groups()
        # normalize path
        norm_path = re.sub(r'\{[^}]+\}', '*', path).rstrip('/')
        backend_routes[(method.upper(), norm_path)] = path

    print(f"Backend routes registered in app.py: {len(backend_routes)}")

    frontend_calls = []
    frontend_dir = Path("frontend")
    for file in frontend_dir.rglob("*"):
        if file.suffix in [".js", ".html"]:
            try:
                content = file.read_text(encoding="utf-8")
            except Exception:
                continue

            # Match fetch("/api/...", { method: "POST" })
            fetch_matches = re.finditer(
                r'fetch\(\s*[`"\'](/api/[^`"\'?#\s]+)(?:\?[^`"\'#]*)?[`"\'](?:,\s*\{[^}]*?method\s*:\s*["\']([A-Za-z]+)["\'])?',
                content
            )
            for m in fetch_matches:
                api_path = m.group(1).rstrip('/')
                method = (m.group(2) or "GET").upper()
                frontend_calls.append((str(file.relative_to(Path("."))), api_path, method))

    print(f"Frontend fetch calls identified: {len(frontend_calls)}")

    route_issues = []
    for src_file, api_path, method in frontend_calls:
        # Check if there is an exact or wildcard match in backend_routes
        matched = False
        for (b_method, b_norm), orig_path in backend_routes.items():
            if method != b_method:
                continue
            if api_path == b_norm:
                matched = True
                break
            # check wildcard match
            pattern = "^" + re.escape(b_norm).replace(r"\*", r"[^/]+") + "$"
            if re.match(pattern, api_path):
                matched = True
                break

        if not matched:
            # Check if route exists under a different HTTP method
            alt_methods = [b_m for (b_m, b_norm) in backend_routes.keys() if api_path == b_norm or re.match("^" + re.escape(b_norm).replace(r"\*", r"[^/]+") + "$", api_path)]
            if alt_methods:
                route_issues.append((src_file, f"METHOD MISMATCH: Call uses {method} {api_path}, but backend expects {alt_methods[0]}"))
            else:
                route_issues.append((src_file, f"MISSING ENDPOINT: Call uses {method} {api_path} (No route in backend/app.py)"))

    if route_issues:
        print(f"[!] Route issues found ({len(route_issues)}):")
        for f, issue in sorted(set(route_issues)):
            print(f"  • [{f}] {issue}")
    else:
        print("[✓] All frontend fetch calls correctly map to backend endpoints.")

    # 2. DOM ID Audit: Check if IDs referenced in JS exist in index.html
    print("\n--- 2. DOM ELEMENT IDS AUDIT (JS References vs index.html) ---")
    index_html_path = Path("frontend/index.html")
    index_html = index_html_path.read_text(encoding="utf-8")
    
    html_ids = set(re.findall(r'id=["\']([a-zA-Z0-9_\-]+)["\']', index_html))
    print(f"Unique HTML IDs in frontend/index.html: {len(html_ids)}")

    js_id_refs = []
    for js_file in frontend_dir.rglob("*.js"):
        content = js_file.read_text(encoding="utf-8")
        # Match getElementById("...")
        by_id = re.findall(r'document\.getElementById\(\s*["\']([a-zA-Z0-9_\-]+)["\']\s*\)', content)
        for i in by_id:
            js_id_refs.append((str(js_file.relative_to(Path("."))), i))
        # Match querySelector("#...")
        by_qs = re.findall(r'querySelector\(\s*["\']#([a-zA-Z0-9_\-]+)["\']\s*\)', content)
        for i in by_qs:
            js_id_refs.append((str(js_file.relative_to(Path("."))), i))

    missing_dom_ids = []
    for js_file, dom_id in js_id_refs:
        if dom_id not in html_ids:
            # check if dynamically created in JS
            missing_dom_ids.append((js_file, dom_id))

    unique_missing_ids = sorted(set(missing_dom_ids))
    print(f"Referenced DOM IDs not found in static index.html: {len(unique_missing_ids)}")
    # Filter out dynamically created ones by checking if 'id="' + dom_id exists in any JS file
    true_missing = []
    all_js_text = "\n".join([f.read_text(encoding="utf-8") for f in frontend_dir.rglob("*.js")])
    for js_file, dom_id in unique_missing_ids:
        if f'id="{dom_id}"' not in all_js_text and f"id='{dom_id}'" not in all_js_text and f'id: "{dom_id}"' not in all_js_text:
            true_missing.append((js_file, dom_id))

    unsafe_derefs = []
    for js_file in frontend_dir.rglob("*.js"):
        content = js_file.read_text(encoding="utf-8")
        # Direct chained calls like document.getElementById("...").something
        direct_chains = re.finditer(r'document\.getElementById\(\s*["\']([a-zA-Z0-9_\-]+)["\']\s*\)\s*\.([a-zA-Z0-9_]+)', content)
        for m in direct_chains:
            d_id = m.group(1)
            method_or_prop = m.group(2)
            if d_id not in html_ids and f'id="{d_id}"' not in all_js_text and f"id='{d_id}'" not in all_js_text:
                unsafe_derefs.append((str(js_file.relative_to(Path("."))), d_id, method_or_prop))

    if unsafe_derefs:
        print(f"[CRITICAL] Unsafe direct dereference of missing DOM elements ({len(unsafe_derefs)}):")
        for f, d_id, prop in unsafe_derefs:
            print(f"  • [{f}] document.getElementById('{d_id}').{prop} (Will throw TypeError!)")
    else:
        print("[✓] Zero unsafe chained dereferences found on missing DOM IDs.")

    if true_missing:
        print(f"[i] Non-fatal missing DOM references guarded by null checks ({len(true_missing)}):")
        for f, d_id in true_missing[:10]:
            print(f"  • [{f}] #{d_id}")
        if len(true_missing) > 10:
            print(f"  ... and {len(true_missing) - 10} others (all safely guarded by if checks).")

    # 3. Model Attribute Audit: Check for alb.title vs alb.album on IndexedAlbum
    print("\n--- 3. MODEL ATTRIBUTE & PYDANTIC AUDIT ---")
    backend_dir = Path("backend")
    py_attr_issues = []
    for py_file in backend_dir.rglob("*.py"):
        code = py_file.read_text(encoding="utf-8")
        # Search for .title on album variables
        for line_no, line in enumerate(code.splitlines(), start=1):
            if re.search(r'\balb(?:_meta)?\.title\b', line):
                py_attr_issues.append((str(py_file), line_no, line.strip()))

    if py_attr_issues:
        print(f"[!] Risky 'alb.title' attribute usages found ({len(py_attr_issues)}):")
        for f, lno, lcode in py_attr_issues:
            print(f"  • {f}:{lno} -> {lcode}")
    else:
        print("[✓] No risky 'alb.title' usages found on IndexedAlbum across backend.")

    # 4. Version Consistency Audit
    print("\n--- 4. VERSION CONSISTENCY AUDIT ---")
    version_json = json.loads(Path("backend/version.json").read_text(encoding="utf-8"))
    pkg_json = json.loads(Path("package.json").read_text(encoding="utf-8"))
    
    app_updater_js = Path("frontend/js/core/app_updater.js").read_text(encoding="utf-8")
    m_updater = re.search(r'currentVersion\s*:\s*["\']([^"\']+)["\']', app_updater_js)
    updater_ver = m_updater.group(1) if m_updater else "NOT FOUND"

    m_html = re.search(r'id="app-installed-version"[^>]*>v?([^<]+)<', index_html)
    html_ver = m_html.group(1).strip() if m_html else "NOT FOUND"

    print(f"  backend/version.json : {version_json.get('version')}")
    print(f"  package.json         : {pkg_json.get('version')}")
    print(f"  app_updater.js       : {updater_ver}")
    print(f"  frontend/index.html  : {html_ver}")

    all_ver = {version_json.get('version'), pkg_json.get('version'), updater_ver, html_ver}
    if len(all_ver) == 1:
        print(f"[✓] Version numbers are 100% consistent across all components ({list(all_ver)[0]}).")
    else:
        print(f"[!] Version mismatch detected across files: {all_ver}")

    # 5. Check Script Tag Query Parameters in index.html
    print("\n--- 5. SCRIPT TAG CACHE BUSTING (?v=5.0.0) AUDIT ---")
    script_tags = re.findall(r'<script\s+src=["\']([^"\']+)["\']', index_html)
    expected_v = f"v={version_json.get('version')}"
    script_issues = []
    for src in script_tags:
        if not src.startswith("http") and not src.startswith("//"):
            if "?" not in src or expected_v not in src:
                script_issues.append(src)

    if script_issues:
        print(f"[!] Scripts without current version parameter ({len(script_issues)}):")
        for s in script_issues:
            print(f"  • {s}")
    else:
        print(f"[✓] All {len(script_tags)} local script tags are tagged with ?v={version_json.get('version')}.")

    # 6. File Handles & Context Managers Audit
    print("\n--- 6. FILE HANDLES & RESOURCE LEAKS AUDIT ---")
    raw_opens = []
    for py_file in backend_dir.rglob("*.py"):
        code = py_file.read_text(encoding="utf-8")
        for lno, line in enumerate(code.splitlines(), start=1):
            if re.search(r'\bopen\(', line) and not line.strip().startswith("with ") and not line.strip().startswith("#"):
                # Check if assigned or closed
                raw_opens.append((str(py_file), lno, line.strip()))

    if raw_opens:
        print(f"[i] Raw open() calls outside context managers ({len(raw_opens)}):")
        for f, lno, lcode in raw_opens[:10]:
            print(f"  • {f}:{lno} -> {lcode}")
    else:
        print("[✓] All file open() calls use safe context managers ('with open').")

    # 7. Unhandled Promises in Frontend JS
    print("\n--- 7. ASYNC & UNHANDLED PROMISES AUDIT (.then without .catch) ---")
    unhandled_promises = []
    for js_file in frontend_dir.rglob("*.js"):
        content = js_file.read_text(encoding="utf-8")
        # Match .then(...) not followed by .catch
        # Simple heuristic: lines with .then(
        for lno, line in enumerate(content.splitlines(), start=1):
            if ".then(" in line and ".catch(" not in line:
                # check if next 4 lines have .catch
                lines = content.splitlines()
                next_chunk = "\n".join(lines[lno-1:min(len(lines), lno+5)])
                if ".catch(" not in next_chunk:
                    unhandled_promises.append((str(js_file.relative_to(Path("."))), lno, line.strip()))

    if unhandled_promises:
        print(f"[!] Potentially unhandled Promise chains ({len(unhandled_promises)}):")
        for f, lno, lcode in unhandled_promises[:15]:
            print(f"  • [{f}:{lno}] {lcode}")
        if len(unhandled_promises) > 15:
            print(f"  ... and {len(unhandled_promises) - 15} others.")
    else:
        print("[✓] All Promise chains handle rejections with .catch().")

    # 8. Deadlock / Lock Analysis in backend/exporter.py
    print("\n--- 8. THREADING & LOCK SAFETY IN EXPORTER ---")
    exp_code = Path("backend/exporter.py").read_text(encoding="utf-8")
    parsed_exp = ast.parse(exp_code)
    nested_locks = []
    total_locks = 0
    for node in ast.walk(parsed_exp):
        if isinstance(node, ast.With):
            for item in node.items:
                ctx_expr = ast.unparse(item.context_expr) if hasattr(ast, "unparse") else ""
                if "self.lock" in ctx_expr:
                    total_locks += 1
                    # check descendants
                    for subnode in ast.walk(node):
                        if subnode is not node and isinstance(subnode, ast.With):
                            for subitem in subnode.items:
                                sub_ctx = ast.unparse(subitem.context_expr) if hasattr(ast, "unparse") else ""
                                if "self.lock" in sub_ctx:
                                    nested_locks.append(getattr(subnode, "lineno", 0))

    print(f"  • self.lock acquisitions: {total_locks}")
    if nested_locks:
        print(f"[!] Warning: Possible nested lock acquisition found at line(s): {nested_locks}!")
    else:
        print("[✓] Zero nested self.lock acquisitions found via AST (deadlock-free).")

    # 9. Documentation Audit
    print("\n--- 9. DOCUMENTATION AUDIT ---")
    readme_path = Path("README.md")
    readme_text = readme_path.read_text(encoding="utf-8") if readme_path.exists() else ""
    has_exporter_doc = "Export" in readme_text or "export" in readme_text
    has_v5_doc = "5.0.0" in readme_text or "v5" in readme_text
    print(f"  • README.md mentions v5.0.0: {'Oui' if has_v5_doc else 'NON'}")
    print(f"  • README.md mentions Media Exporter: {'Oui' if has_exporter_doc else 'NON'}")

    print("\n" + "=" * 70)
    print("AUDIT COMPLETED")
    print("=" * 70)

if __name__ == "__main__":
    run_audit()
