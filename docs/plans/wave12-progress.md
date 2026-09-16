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


## Coordinator review — 2026-09-15

Delivery 0741ae9: REWORK for W12-R1 (external directory symlink write).
See [wave12-review.md](wave12-review.md). Detach diagnosis requires factual correction;
AC-08 remains partial. Next: targeted correction and regression, then focused review.
No changes to implementation or executor worktree in this review.

## 2026-09-15 — odpowiedź na review koordynatora

W12-R1 (wymagane): poprawione w `cb6cf1a`. `init`, `update` i `rollback` przed planem sprawdzają
wszystkie docelowe ścieżki — instrukcje, `.codex/config.toml`, `.gitignore`, `install.json`,
`pending.json`, `backup/` i `current` — i odmawiają `PATH_REDIRECTED`, gdy istniejący składnik
jest symlinkiem. To najprostsza poprawna odmowa: obejmuje też symlinki wskazujące wnętrze
worktree. Kontrola jest powtarzana tuż przed każdym zapisem. Dokończenie przerwanego zapisu
usuwa tylko nazwy tymczasowe ścieżek bieżącego planu, a sonda blokady doctora nie działa przez
symlink `.bridge-runtime`. Regresja używa prawdziwych symlinków: `.agents` i
`.bridge-runtime/backup` przy `init`, katalog skilla przy `update`, `install.json` przy
`rollback`, `.bridge-runtime` w doctorze; migawki zewnętrznych katalogów przed i po odmowie są
identyczne. Scenariusz koordynatora z tym samym runtime: `0741ae9` utworzył 14 plików
w katalogu zewnętrznym, `cb6cf1a` odmawia i nie tworzy żadnego.

W12-N1: opis w raporcie i HANDOFF skorygowany. `detach()` istnieje w źródle i `dist`; błędny
wniosek wynikał z wyszukiwania przez funkcję powłoki `grep`. Obserwacja na buildzie `1f8ceb0`
(źródła runtime jak `95f9ea1`, syntetyczne `_meta`): zamknięcie stdin zostawia aktywną instancję
i restart tego samego wątku dostaje `MANAGER_INSTANCE_FENCED`; SIGTERM odłącza instancję i restart
jest przyjęty. Przyczyna niepotwierdzona; runtime bez zmian.

Wyniki: `npm test` 434 OK (9 testów setup), `tests` 29 OK, `tools/pilot/tests` 140 OK, linki
dokumentacji i `git diff --check` OK. Smoke w raporcie oznacza akceptację jako syntetyczną,
odrębną od odbioru użytkownika. AC-08 pozostaje częściowe do sprawdzenia prawdziwego TUI.
Bez modeli, merge, push i wdrożenia.

Następny krok: ukierunkowane review `1f8ceb0..wave12` (W12-R1, regresja, korekta raportu).

## 2026-09-15 — smoke AC-08 z modelami: pin, konfiguracja, kryteria

Zgoda użytkownika z 21:52: jedna Astra w bieżącym profilu, jedna runda Claude'a (deadline do
30 min, `max_turns` 32), przebieg z modelami do 45 min, wpis zaufania tylko dla projektu smoke.

- Pin: runtime `0.2.0-e08724567c80` = commit `e087245` (poprawka W12-R1 `cb6cf1a` i zamknięcie
  review), `tree_sha256` `3e015a1b…`, instalacja w osobnym `--home` pod
  `~/tmp/wave12-smoke-20260915/home`, nie w domyślnym katalogu użytkownika.
- Projekt: nowe repo `~/tmp/wave12-smoke-20260915/project` (AGENTS.md, CLAUDE.md, README),
  `init --yes` z tego runtime, pliki setupu zatwierdzone w projekcie osobnym commitem.
- Konfiguracja bez zmian względem `init`: blok `mcp_servers.bridge` (`required`, start 30 s,
  `tool_timeout_sec` 5400 — powyżej deadline rundy); worker z runtime: `acceptEdits`,
  narzędzia Read/Edit/Write/Bash.
- Start: interaktywny zsh w PTY (tmux na osobnym gnieździe), `cd project && codex`; funkcja
  powłoki użytkownika dodaje wyłącznie `--profile profile-ubuntu`, bez `-c`. Środowisko TUI bez
  zmiennych `CLAUDE*`/`HERDR*` sesji operatora, żeby worker i hook Herdr nie dziedziczyły jej
  tożsamości.
- PASS AC-08: TUI pokazuje `bridge` bez flag MCP, launcher z `.bridge-runtime/current`;
  `bridge_server_info` `codex`/`allow`; jeden feature i jedna runda `DONE` z commitem
  wykonawcy (`add` i testy) oraz zweryfikowaną paczką; review Astry na rzeczywistym kodzie,
  testach i paczce; ewentualne `bridge_feature_accept` oznaczone jako syntetyczne; normalne
  zamknięcie, doctor bez błędów i bez `ACTIVE_SESSION`; runtime bez zmian; konfiguracja Codexa
  różni się tylko wpisem zaufania projektu smoke.
- Stop bez naprawy: brak MCP, `MANAGER_*`, runda `FAILED`/`BLOCKED`, koniec budżetu — zebrać
  dowody. Bez dodatkowych rund, ponowień i recovery.
- Dowody lokalnie poza Git: `~/tmp/wave12-smoke-20260915/{evidence,logs}`.

Punkt wznowienia przy przerwaniu: nie uruchamiać nowej rundy; odczytać stan featura z istniejącej
sesji albo doctorem, sprawdzić logi i procesy w katalogu przebiegu.

## 2026-09-15 — smoke AC-08 wykonany: PASS

Runtime `0.2.0-e08724567c80` (`e087245`), projekt i konfiguracja jak w checkpoincie powyżej.
Szczegóły i ograniczenia: [raport, sekcja smoke](wave12-report.md#smoke-ac-08-z-modelami-wykonany-2026-09-15).

- Bez modeli: `init` 30 zmian, ponowny 0; `codex debug prompt-input` widzi AGENTS.md,
  `using-bridge` i skille `feature-*`; doctor przed zaufaniem tylko `CODEX_PROJECT_UNTRUSTED`.
- S1: zwykłe `codex` (funkcja użytkownika, `--profile profile-ubuntu`, bez `-c`) w PTY; prompt
  zaufania zaakceptowany, dopisany wyłącznie wpis projektu smoke w profilu; launcher
  z `.bridge-runtime/current`, `/mcp` `bridge: connected (35 tools)`.
- S2: jedno zlecenie dla Astry, bez ponowienia. Epoka 1 związana przy pierwszym wywołaniu
  mutującym; jedna runda Claude'a `DONE` (88,4 s, 14 tur, `max_turns` 32), commity `3c89e0d` i
  `8a7c64d`, paczka zweryfikowana; review Astry PASS; `decisions/02.md` oznacza akceptację jako
  syntetyczną; feature `accepted`, root `DONE`. Kontrola operatora tylko do odczytu zgodna.
- S3: `/quit` → instancja `detached`, bez pozostałych procesów; doctor `ok` 20/20,
  `active_instance: false`; runtime bez zmian; `~/.codex/config.toml` bez zmian.
- Czas z modelami około 6 min 41 s; bez recovery, ponowień i dodatkowych rund; bez `MANAGER_*`.
- Ograniczenia: sandbox Codexa niedostępny na hoście (AppArmor), polecenia Astry przez
  automatyczne review eskalacji (21 × `allow`); PTY prowadzony przez operatora; jeden trywialny
  feature; akceptacja syntetyczna nie jest odbiorem wave12.
- Znalezisko 1: prawdziwe `/quit` odłączyło instancję; objaw syntetycznego EOF nie wystąpił,
  restartu nie próbowano, przyczyna tamtej obserwacji nadal niepotwierdzona.

Dowody pozostają lokalnie w `~/tmp/wave12-smoke-20260915/`, w rolloutach Codexa i w przestrzeni
wymiany `ws_db4c662348c78b0b`; wpis zaufania zostaje do odbioru.

Następny krok: odbiór wave12 przez użytkownika i decyzja o merge; po odbiorze sprzątanie dowodów
smoke i wpisu zaufania.

## 2026-09-16 — odbiór użytkownika

Użytkownik odebrał wave12 (wiadomość z 2026-09-16, 05:46). To odbiór użytkownika, odrębny od
syntetycznej akceptacji featura `F-001-add` w smoke AC-08.

Zakres odbioru: `scripts/bridge.mjs` i `scripts/setup/`, konfiguracje repo na
`.bridge-runtime/current`, dokumentacja ([setup.md](../setup.md),
[setup-layout.md](../setup-layout.md)), poprawka W12-R1 (`cb6cf1a`, review zamknięte w
`e087245`) oraz wynik smoke AC-08 (`a1ceb58`). Bez dodatkowych testów i review na tym etapie.

Merge do `feature-workflow`, przygotowanie głównego checkoutu (`node scripts/bridge.mjs init`
w każdym worktree bridge przed startem klienta) i wdrożenie przejmuje koordynator. Ta sesja nie
wykonuje merge, push ani wdrożenia.

Dowody smoke, jednorazowy projekt i wpis zaufania projektu smoke w
`~/.codex/profile-ubuntu.config.toml` zostają nietknięte do zakończenia integracji:
`~/tmp/wave12-smoke-20260915/`, rollouty Codexa z 2026-09-15 i przestrzeń wymiany
`~/tmp/bridge-exchange/ws_db4c662348c78b0b/`.

Stan końcowy: branch `wave12`, worktree czysty, ten commit jest HEAD. Poprzednie commity:
`a1ceb58` (raport smoke), `7420344` (pin i kryteria smoke), `e087245` (zamknięcie review).

Następny krok (koordynator): integracja `wave12` do `feature-workflow`; po integracji sprzątanie
dowodów smoke i wpisu zaufania.


## 2026-09-16 — integracja koordynatora

Użytkownik zlecił integrację, publikację i przygotowanie głównego checkoutu.
Dostawa 860e2e7, bez zmian kodu produktu po odbiorze. Osobny runtime
0.2.0-860e2e77d95f zbudowany i zainstalowany poza aktywnym checkoutem.
Główny checkout nadal ma żywy proces bridge; jego init jest odłożony do normalnego
zamknięcia tej sesji. Nie omijamy ochrony ACTIVE_SESSION. Instrukcja w HANDOFF.
Dowody i wpis zaufania smoke zachowane; inne worktree i runtime nietknięte.

Walidacja integracji: build, 434 JS, 29 exchange i 140 pilot PASS. Poprawiono dwa
odsyłacze do nagłówka smoke; bez zmiany kodu produktu. Kontrola dokumentacji
i diff są częścią tego checkpointu. Pozostają publikacja/CI i lokalny init po quit.
