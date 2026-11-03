#!/usr/bin/env python3
"""Gates de calidad de Zordon: corren en cada commit (CI) y deciden si un cambio puede avanzar.

  checks        install + lint/test/build/e2e de [commands] en .agent/project.toml
  secretos      claves y tokens en las líneas agregadas
  dependencias  las nuevas existen en su registro y no son recién publicadas; npm/composer/uv audit sin altas
  política      (solo ramas agent/*) sin rutas protegidas; el tamaño del diff no se limita

Configuración opcional en `[gates]` de .agent/project.toml: min_package_age_days, skip (lista de gates).
Generado por `zordon gates sync`; la fuente vive en zordon/gates/. Solo stdlib.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path.cwd()
MANIFEST = tomllib.loads((ROOT / ".agent" / "project.toml").read_text()) if (ROOT / ".agent" / "project.toml").exists() else {}
CONF = {"min_package_age_days": 14, "skip": []} | MANIFEST.get("gates", {})
SECRETS = [
    ("llave privada", r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY"),
    ("AWS access key", r"\bAKIA[0-9A-Z]{16}\b"),
    ("token de GitHub", r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}"),
    ("API key de Anthropic", r"\bsk-ant-[A-Za-z0-9_-]{20,}"),
    ("API key de OpenAI", r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}"),
    ("token de Slack", r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    ("API key de Google", r"\bAIza[0-9A-Za-z_-]{35}\b"),
    ("token de Cloudflare / genérico asignado", r"(?i)\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*['\"][A-Za-z0-9/+_=-]{24,}['\"]"),
]
LOCKFILES = (".lock", "package-lock.json", "pylock.toml")  # generados: no se revisan por secretos
results: list[tuple[str, bool, str]] = []


def sh(*cmd, check=False, shell=False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd[0] if shell else list(cmd), cwd=ROOT, capture_output=True, text=True, shell=shell, check=check)


def report(gate: str, ok: bool, detail: str):
    results.append((gate, ok, detail))
    print(f"{'✔' if ok else '✖'} {gate}: {detail}", flush=True)


def branch() -> str:
    return os.environ.get("GITHUB_REF_NAME") or sh("git", "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()


# La rama donde se integran los PRs: main, salvo que el pipeline diga otra (GATES_BASE; `develop` en algunos repos
# adoptados: gates/azure-pipelines.yml la toma del blueprint).
BASE = os.environ.get("GATES_BASE") or "main"


def base_ref() -> str:
    """Contra qué se compara: la rama base para las ramas; el commit anterior para la base."""
    if branch() != BASE and sh("git", "rev-parse", "--verify", "-q", f"origin/{BASE}").returncode == 0:
        return sh("git", "merge-base", f"origin/{BASE}", "HEAD").stdout.strip()
    before = os.environ.get("GATES_BEFORE", "")
    if before and set(before) != {"0"}:
        return before
    return "HEAD~1" if sh("git", "rev-parse", "--verify", "-q", "HEAD~1").returncode == 0 else ""


def changed(base: str) -> tuple[list[str], list[tuple[str, str]], int]:
    """Archivos cambiados, líneas agregadas (archivo, línea) y total de líneas tocadas desde base
    (sin contar lockfiles)."""
    if not base:
        files = sh("git", "ls-files").stdout.split()
        return files, [], 0
    files = [f for f in sh("git", "diff", "--name-only", base, "HEAD").stdout.split("\n") if f]
    added, current, counted, total = [], None, True, 0
    for line in sh("git", "diff", "-U0", base, "HEAD").stdout.splitlines():
        if line.startswith("diff --git "):
            counted = not line.endswith(LOCKFILES)
        elif line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else None
        elif line.startswith("+") and not line.startswith("+++") and current:
            added.append((current, line[1:]))
            total += counted
        elif line.startswith("-") and not line.startswith("---"):
            total += counted
    return files, added, total


# ---------------------------------------------------------------- gates

def gate_checks():
    cmds = MANIFEST.get("commands", {})
    setup = cmds.get("install")
    if setup:
        r = sh(setup, shell=True)
        if r.returncode:
            return report("checks", False, f"`{setup}` falló:\n{(r.stdout + r.stderr)[-1500:]}")
    ran = []
    for name in ("lint", "test", "build", "e2e"):
        if not cmds.get(name):
            continue
        r = sh(cmds[name], shell=True)
        if r.returncode:
            return report("checks", False, f"`{cmds[name]}` falló:\n{(r.stdout + r.stderr)[-2500:]}")
        ran.append(name)
    report("checks", True, ", ".join(ran) or "sin comandos declarados en [commands]")


def gate_secrets(added):
    hits = []
    for f, line in added:
        if "gates: allow-secret" in line or f.endswith(LOCKFILES):
            continue
        for label, pattern in SECRETS:
            if re.search(pattern, line):
                hits.append(f"{f}: {label}")
                break
    report("secretos", not hits, "ninguno en las líneas agregadas" if not hits else
           "posibles secretos (si es un falso positivo, agregá `gates: allow-secret` en la línea): " + "; ".join(hits[:10]))


def registry_created(kind: str, name: str) -> dt.datetime | None:
    url = {"npm": f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@')}",
           "composer": f"https://repo.packagist.org/p2/{name}.json",
           "pypi": f"https://pypi.org/pypi/{name}/json"}[kind]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=15) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    if kind == "npm":
        return dt.datetime.fromisoformat(data["time"]["created"].replace("Z", "+00:00"))
    if kind == "composer":
        times = [v.get("time") for v in data.get("packages", {}).get(name, []) if v.get("time")]
        return min(dt.datetime.fromisoformat(t) for t in times) if times else None
    uploads = [f["upload_time_iso_8601"] for files in data.get("releases", {}).values() for f in files]
    return min(dt.datetime.fromisoformat(u.replace("Z", "+00:00")) for u in uploads) if uploads else None


def deps_at(rev: str) -> dict[str, set[str]]:
    def show(path):
        r = sh("git", "show", f"{rev}:{path}") if rev else None
        return r.stdout if r and r.returncode == 0 else ""
    out = {"npm": set(), "composer": set(), "pypi": set()}
    if txt := show("package.json"):
        d = json.loads(txt)
        out["npm"] = set(d.get("dependencies", {})) | set(d.get("devDependencies", {}))
    if txt := show("composer.json"):
        d = json.loads(txt)
        out["composer"] = {k for k in {**d.get("require", {}), **d.get("require-dev", {})} if "/" in k}
    name = lambda req: re.split(r"[<>=!~\[; @]", req.strip())[0].lower().replace("_", "-")
    if txt := show("requirements.txt"):
        out["pypi"] = {name(l) for l in txt.splitlines() if l.strip() and not l.startswith(("#", "-"))}
    if txt := show("pyproject.toml"):
        d = tomllib.loads(txt)
        reqs = d.get("project", {}).get("dependencies", []) + [r for g in d.get("dependency-groups", {}).values() for r in g if isinstance(r, str)]
        out["pypi"] |= {name(r) for r in reqs}
    return out


def gate_dependencies(base: str):
    before, after = deps_at(base), deps_at("HEAD")
    new = [(k, n) for k in after for n in sorted(after[k] - before[k])]
    problems, checked = [], []
    min_age = dt.timedelta(days=int(CONF["min_package_age_days"]))
    for kind, name in new:
        try:
            created = registry_created(kind, name)
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as e:
            problems.append(f"{name}: no pude verificarlo en el registro ({e})")
            continue
        if created is None:
            problems.append(f"{name}: no existe en el registro ({kind}) — ¿nombre inventado?")
        elif dt.datetime.now(dt.timezone.utc) - created < min_age:
            problems.append(f"{name}: publicado hace menos de {min_age.days} días ({created:%Y-%m-%d})")
        else:
            checked.append(name)
    if (ROOT / "package-lock.json").exists():
        r = sh("npm", "audit", "--audit-level=high", "--omit=dev")
        if r.returncode:
            problems.append("npm audit: vulnerabilidades altas o críticas en dependencias de producción:\n" + r.stdout[-1200:])
    if (ROOT / "composer.lock").exists():
        r = sh("composer", "audit", "--locked", "--no-dev", "--abandoned=report", "--no-interaction")
        if r.returncode:
            problems.append("composer audit: vulnerabilidades en dependencias de producción:\n" + r.stdout[-1200:])
    if (ROOT / "uv.lock").exists() and not shutil.which("uv"):
        problems.append("uv audit: falta `uv` para auditar uv.lock")
    elif (ROOT / "uv.lock").exists():
        r = sh("uv", "audit", "--locked", "--no-dev", "--preview-features", "audit-command")
        if r.returncode:
            problems.append("uv audit: vulnerabilidades en dependencias de producción:\n" + (r.stdout + r.stderr)[-1200:])
    detail = (f"nuevas verificadas: {', '.join(checked)}" if checked else "sin dependencias nuevas") if not problems else "; ".join(problems)
    report("dependencias", not problems, detail)


def gate_policy(files, total):
    if not branch().startswith("agent/"):
        return report("política", True, "no aplica fuera de ramas agent/*")
    protected = [l.strip() for l in (ROOT / ".agent" / "protected-paths").read_text().splitlines()
                 if l.strip() and not l.startswith("#")] if (ROOT / ".agent" / "protected-paths").exists() else []
    touched = sorted({f for f in files for p in protected if f == p or (p.endswith("/") and f.startswith(p))})
    problems = []
    if touched:
        problems.append(f"toca rutas protegidas ({', '.join(touched)}): este PR lo mergea un humano")
    report("política", not problems, "; ".join(problems) or f"{len(files)} archivos, {total} líneas, sin rutas protegidas")


def main():
    base = base_ref()
    files, added, total = changed(base)
    print(f"gates de Zordon · rama {branch()} · contra {base[:12] or '(primer commit)'}\n", flush=True)
    gates = {"política": lambda: gate_policy(files, total), "secretos": lambda: gate_secrets(added),
             "dependencias": lambda: gate_dependencies(base), "checks": gate_checks}
    for name, fn in gates.items():
        if name in CONF["skip"]:
            report(name, True, "salteado por [gates] skip")
            continue
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — un error del gate es un gate fallido, con su motivo
            report(name, False, f"error del gate: {type(e).__name__}: {e}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("## Gates de Zordon\n\n| Gate | Resultado | Detalle |\n| --- | --- | --- |\n")
            for g, ok, d in results:
                f.write(f"| {g} | {'✔' if ok else '✖'} | {d.splitlines()[0][:300]} |\n")
    failed = [g for g, ok, _ in results if not ok]
    print(f"\n{'✖ fallaron: ' + ', '.join(failed) if failed else '✔ todos los gates pasaron'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
