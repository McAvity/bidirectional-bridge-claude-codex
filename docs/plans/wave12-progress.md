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

## 2026-09-15 — implementacja i walidacja

Commity: `e1126a2` (CLI `scripts/bridge.mjs` + testy), `85eb47f` (konfiguracje repo na
`.bridge-runtime/current`), `7bceb04` (dokumentacja). Raport z pokryciem AC:
[wave12-report.md](wave12-report.md).

Wyniki bez modeli: build OK; `npm test` 433 OK (8 nowych testów setup); `tests` 29 OK;
`tools/pilot/tests` 140 OK; linki dokumentacji OK. Świeży klon przy `7bceb04`: install,
init klonu bridge (tylko wybór runtime), init dwóch worktree projektu, doctor z prawdziwym
Codex 0.154 `ok`, `codex app-server thread/start` uruchamia bridge z bloku projektu.

Poprawki w trakcie: odmowa `RUNTIME_INCOMPLETE` zamiast wyjątku dla niekompletnego runtime;
doctor rozpoznaje zaufanie z plików Codexa (override `-c` nie działa w 0.154) i rozwiązuje
worktree dowolnym kompletnym runtime, gdy nie ma wyboru.

Ograniczenia: literalny start TUI i rzeczywista delegacja niezweryfikowane (smoke do zgody);
`certification-manifest.mjs` nie przechodzi już na bazie. Znalezisko zastane: po normalnym
zamknięciu launchera instancja nie jest odłączana (`MANAGER_INSTANCE_FENCED` po restarcie;
brak `IdentityRuntime.detach`) — osobne zadanie.

Następny krok: review i odbiór wave12; decyzja o smoke z budżetem z raportu; po merge
`node scripts/bridge.mjs init` w każdym worktree bridge przed startem klienta.
