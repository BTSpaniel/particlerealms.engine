# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Static homepage cards derived from the canonical WebGPU OS app manifests."""

from html import escape
from pathlib import Path
from urllib.parse import urlencode

from .site import read_webgpu_os_indexed_manifests


CATALOG_START = "<!-- APP-DEMO-CATALOG:START -->"
CATALOG_END = "<!-- APP-DEMO-CATALOG:END -->"
CATEGORY_LABELS = {
    "creative": "Create", "games": "Games", "internet": "Internet",
    "productivity": "Productivity", "system": "System", "tools": "Tools",
    "utility": "Everyday", "webgpu": "WebGPU", "debug": "Developer", "security": "Security",
}

# Presentation metadata only: membership, names, icons and categories always
# come from apps/index.json and its manifests. New visible apps appear without
# adding another registry entry, using their manifest description by default.
APP_SUMMARIES = {
    "os.setup-center": "Review account and device setup in one place.",
    "os.docs": "Browse the OS guides and reference documentation.",
    "browser": "Browse websites in an isolated app window.",
    "os.devconsole": "Inspect logs, explore source, and run developer commands.",
    "os.terminal": "Explore files, processes, and OS commands in a terminal.",
    "os.files": "Browse files, preview content, and organize folders.",
    "os.gpu-manager": "Inspect your GPU, its capabilities, and active surfaces.",
    "os.llm-chat": "Import a local language model and generate text on your GPU.",
    "os.task-manager": "Inspect running apps, memory, storage, and GPU activity.",
    "os.pkg-manager": "Browse installed packages, updates, and trust information.",
    "os.pkg-studio": "Turn your app files into a signed installable package.",
    "os.storage-manager": "Inspect storage usage, saved data, and mounted folders.",
    "os.permissions": "Review what apps can access and manage their permissions.",
    "os.user-management": "Create and manage local user profiles.",
    "os.service-manager": "Inspect OS services, their status, and dependencies.",
    "os.log-viewer": "Search activity logs and investigate related events.",
    "os.cmd-registry": "Explore available commands and their options.",
    "os.browser-bridge-manager": "Check and manage the Companion browser connection.",
    "os.network-manager": "Inspect Realm connections, discovery, and network health.",
    "os.tab-manager": "Find and manage browser tabs through Companion.",
    "os.request-rule-manager": "Manage browser request filters and redirects.",
    "os.chatroom": "Explore secure messaging and conversations on the Realm network.",
    "os.calculator": "Calculate with scientific tools, memory, and history.",
    "os.ai-echo": "Explore your AI companion, workspace tools, and memory.",
    "os.realmforge": "Author assets and explore simulation and reconstruction tools.",
    "os.the-virtual-realm": "Open a verified realm you have prepared in your profile.",
    "os.notepad": "Write documents, edit code, and read PDFs.",
    "os.clock": "Use world clocks, a stopwatch, and timers.",
    "os.calendar": "Plan events, organize tasks, and set reminders.",
    "os.paint": "Draw and paint with brushes, layers, and image tools.",
    "os.sewing": "Draft sewing patterns, manage measurements, and prepare prints.",
    "os.ambient-studio": "Create live wallpapers with shaders, layers, and media.",
    "os.minesweeper": "Explore a 3D minefield and mark the hidden mines.",
    "os.snake": "Guide a snake through a dimensional world.",
    "os.pinball": "Play a WebGPU pinball table with touch or keyboard controls.",
    "os.the-first-shard": "Explore a cooperative action RPG and living kingdom.",
    "os.particles": "Design particle effects and explore live simulations.",
    "os.particle-realms": "Build and inspect a local Construct workspace.",
    "os.fractal": "Explore fractal shapes, colors, and live visual effects.",
    "os.smith-lab": "Explore Smith charts and design impedance-matching networks.",
    "os.sysmon": "Follow app activity, resource use, and performance history.",
    "os.sound": "Adjust sound, output devices, and media playback.",
    "os.settings": "Explore appearance, app preferences, and OS settings.",
    "theme-manager": "Customize themes, windows, accessibility, and shortcuts.",
    "os.control-panel": "Review system health and open the tools you need.",
}
PROFILE_REQUIREMENTS = {
    "os.browser-bridge-manager": "Requires an installed Companion connection in your profile.",
    "os.tab-manager": "Requires an installed Companion connection in your profile.",
    "os.request-rule-manager": "Requires an installed Companion connection in your profile.",
}
UNAVAILABLE_APPS = {
    "os.the-virtual-realm": "This world experience is still in development.",
}
SETUP_NOTES = {
    "os.notepad": "Draft recovery requires secure storage setup.",
    "os.ai-echo": "Set up an AI provider to use chat and generation.",
    "os.llm-chat": "Import or select a local model before generating.",
    "os.chatroom": "Uses the Realm network for messages.",
}
_FEATURED_ORDER = {"os.calculator": 0, "os.paint": 1, "os.fractal": 2}


def homepage_app_catalog(root):
    """Return visible app presentation records without importing any app code."""
    catalog = []
    for _, manifest, _ in read_webgpu_os_indexed_manifests(root):
        if manifest.get("hidden") is True or manifest.get("surface") == "background":
            continue
        app_id = manifest["appId"]
        name = manifest.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Homepage app {app_id!r} requires a display name")
        category = manifest.get("category") or "other"
        if not isinstance(category, str):
            raise ValueError(f"Homepage app {app_id!r} has an invalid category")
        category_label = CATEGORY_LABELS.get(category, category.replace("-", " ").title())
        summary = APP_SUMMARIES.get(app_id, manifest.get("description") or "")
        if not isinstance(summary, str):
            raise ValueError(f"Homepage app {app_id!r} has an invalid description")
        icon = manifest.get("icon") or ""
        if not isinstance(icon, str):
            raise ValueError(f"Homepage app {app_id!r} has an invalid icon")
        requirement = PROFILE_REQUIREMENTS.get(app_id, "")
        available = app_id not in UNAVAILABLE_APPS
        note = UNAVAILABLE_APPS.get(app_id, "") or requirement or SETUP_NOTES.get(app_id, "")
        keywords = manifest.get("keywords") or []
        if not isinstance(keywords, list) or any(not isinstance(item, str) for item in keywords):
            raise ValueError(f"Homepage app {app_id!r} has invalid search keywords")
        session = "profile" if requirement else "demo"
        catalog.append({
            "appId": app_id, "name": name, "icon": icon, "category": category,
            "categoryLabel": category_label, "summary": summary, "note": note,
            "requiresProfile": bool(requirement), "session": session, "available": available,
            "search": " ".join((name, category, category_label, summary, note, *keywords)).casefold(),
        })
    return sorted(catalog, key=lambda app: (
        _FEATURED_ORDER.get(app["appId"], len(_FEATURED_ORDER)),
        app["categoryLabel"].casefold(), app["name"].casefold(), app["appId"],
    ))


def render_homepage_app_cards(root):
    """Render native links and searchable cards from current canonical manifests."""
    cards = []
    for app in homepage_app_catalog(root):
        required = "true" if app["requiresProfile"] else "false"
        href = escape("/webgpu-os/app.html?" + urlencode({"app": app["appId"], "session": app["session"]}))
        attributes = {
            "data-app-id": app["appId"], "data-app-category": app["category"],
            "data-app-category-label": app["categoryLabel"], "data-app-search": app["search"],
            "data-app-default-session": app["session"], "data-app-session": app["session"],
            "data-app-requires-profile": required,
            "data-app-available": "true" if app["available"] else "false",
        }
        card_attributes = " ".join(f'{name}="{escape(value)}"' for name, value in attributes.items())
        launch_attributes = " ".join(f'{name}="{escape(value)}"' for name, value in {
            "data-app-id": app["appId"], "data-app-name": app["name"],
            "data-app-session": app["session"], "data-app-requires-profile": required,
        }.items())
        label = "Open with profile" if app["requiresProfile"] else "Try here"
        external_label = "Open with profile ↗" if app["requiresProfile"] else "Open app ↗"
        lines = [
            f'      <article class="app-demo-choice app-demo-card" {card_attributes}>',
            f'        <span class="app-demo-icon" aria-hidden="true">{escape(app["icon"])}</span>',
            f'        <span class="app-demo-category">{escape(app["categoryLabel"])}</span>',
            *(['        <span class="app-demo-profile-label">Profile required</span>'] if app["requiresProfile"] else []),
            *(['        <span class="app-demo-unavailable-label">Coming soon</span>'] if not app["available"] else []),
            f'        <h3>{escape(app["name"])}</h3>',
            f'        <p class="app-demo-summary">{escape(app["summary"])}</p>',
        ]
        if app["note"]:
            lines.append(f'        <p class="app-demo-requirement">{escape(app["note"])}</p>')
        if app["available"]:
            lines.extend([
                f'        <a href="{href}" data-app-demo-load {launch_attributes}>{label}</a>',
                f'        <a href="{href}" data-app-demo-open {launch_attributes} target="_blank" rel="noopener">{external_label}</a>',
            ])
        lines.append("      </article>")
        cards.append("\n".join(lines))
    return "\n".join(cards)


def render_homepage_app_catalog(source, root):
    """Replace only the one explicitly managed card block, preserving authored UI."""
    if source.count(CATALOG_START) != 1 or source.count(CATALOG_END) != 1:
        raise ValueError("Homepage requires exactly one APP-DEMO-CATALOG marker pair")
    start = source.index(CATALOG_START) + len(CATALOG_START)
    end = source.index(CATALOG_END)
    if end < start:
        raise ValueError("Homepage APP-DEMO-CATALOG markers are out of order")
    return source[:start] + "\n" + render_homepage_app_cards(root) + "\n    " + source[end:]


def update_homepage_app_catalog(path, root, *, check=False):
    """Regenerate one source/deployment page or reject stale generated cards."""
    path = Path(path)
    source = path.read_text(encoding="utf-8")
    rendered = render_homepage_app_catalog(source, root)
    if check and rendered != source:
        raise ValueError(f"Homepage app catalogue is stale: {path}; run tools/generate_homepage_app_catalog.py")
    if rendered != source:
        path.write_text(rendered, encoding="utf-8")
    return rendered != source
