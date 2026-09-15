# Wave12 — postęp

## 2026-09-14 — plan

Plan: [wave12.md](wave12.md). Baza: feature-workflow `1eae147`.
Zapisano zakres init/update/rollback/doctor, niezależne worktree Herdr,
przypięte runtime oraz punkt współpracy z wave13. Implementacja nie rozpoczęta.
Brak zmian runtime, konfiguracji użytkownika, modeli i publikacji artefaktów.

Następny krok: zlecić wykonanie w nowym worktree od commita planu. Rozpoznać obecne
CLI i konfiguracje klientów; ustalić minimalną instalację i wspólny układ danych,
następnie wykonać autoryzowany zakres. Smoke z modelami wymaga osobnego budżetu.

## 2026-09-15 — rozpoznanie i układ danych

Worktree `~/.herdr/worktrees/bridge/wave12`, branch `wave12` od `95f9ea1`, stan czysty.
Aktywne runtime innych sesji (wave7 na `bridge-runtime-956b171`, sesja w głównym checkout)
tylko odczytane; niczego w nich nie zmieniano.

Ustalenia z lokalnych klientów (Codex 0.154.0, Claude Code 2.1.272), bez modeli:
- Codex wczytuje projektowe `.codex/config.toml` tylko dla zaufanego projektu; worktree
  dziedziczy zaufanie głównego repo; zaufanie z pliku profilu działa tylko z `--profile`.
  Błędny TOML projektu blokuje start z komunikatem parsera. (izolowany `CODEX_HOME`)
- Względne `cwd`/`args` MCP są liczone od katalogu procesu Codexa: prawdziwy `codex app-server`
  z cwd = korzeń projektu uruchomił sondę MCP przy `thread/start`; z cwd = katalog nadrzędny nie.
- Codex wykrywa skille projektu w `.agents/skills` i `.codex/skills`; Claude w `.claude/skills`.
- Próbny build przypiętego commita poza repo: `npm ci` ~2 s, build ~2 s, ~385 MB.

Decyzje: jedna dystrybucja = `git archive` przypiętego commita z lokalnego klona + `npm ci`
+ build do `<home>/runtimes/<id>` (read-only). Jedno wejście `node scripts/bridge.mjs`
(`install`, `init`, `update`, `rollback`, `doctor`). Wybór per worktree = lokalny symlink
`.bridge-runtime/current`; `.codex/config.toml` pozostaje przenośny. Bez wrappera — start
zwykłym `codex` w korzeniu zaufanego worktree. Aktywne użycie: skan `/proc` (proces launchera
tego worktree, otwarte pliki `.bridge/`, klient z cwd = worktree). Wspólny układ dla wave13:
[setup-layout.md](../setup-layout.md).

Następny krok: implementacja CLI i testów bez modeli.
