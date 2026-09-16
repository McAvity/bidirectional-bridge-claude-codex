# Wave14 — postęp

## 2026-09-16 — plan zapisany

Plan: [wave14.md](wave14.md). Baza: feature-workflow `6795703`.
Zapisano uzgodniony kierunek: instalacja pluginu raz, włączenie projektu skillem,
nowe worktree bez ręcznego init; wspólny produkt z pakietami Codex/Claude.
Implementacja nie rozpoczęta. Bez instalacji pluginów, modeli, zmian runtime i push.

Następny krok po zleceniu: próby workspace pluginowego MCP, instrukcji delegowanego
Claude’a oraz zachowania przypiętych wersji po aktualizacji pluginu. Uzgodnić bazę
z pracującym wave13 przed integracją wspólnych interfejsów; nie zmieniać jego worktree.

## 2026-09-16 — wykonanie autoryzowane

Cały plan zlecony; Claude implementuje przez bridge, Codex koordynuje i robi review.
Baza czysta `1cd1be78e3c18d5155b45d9dd95c27bd2a663c14`, branch/worktree wave14.
[Autoryzacja i hashe](../features/F-W14-plugin-distribution/decisions/01.md).
Kod, oba pluginy i marketplace pozostają w tym repo; pakiety ze wspólnych źródeł.
Runtime prowadzący pracę: osobny niezmienny `0.2.0-860e2e77d95f`.
Codex 0.154.0, Claude Code 2.1.273. Sandbox bwrap nie startuje; odczyty przez zatwierdzoną eskalację.
Wave13 ma lokalnie przejrzane logowanie i trwa implementacja diagnose; brak odebranego interfejsu w tej bazie. Nie zmieniono jego worktree.
Następny krok: W14-01, trzy próby bez modeli i propozycja granicy integracyjnej. Testy produktu jeszcze niewykonane.

## 2026-09-16 — próby W14-01 i review

Claude: `dd1e694` próby/kontrakty, `c958204` ledger wznowienia. Task `task_cct6fr9gkc`
zatrzymał się na max_turns; wznowiony dokładnie w tej samej sesji zakończył DONE.
Paczka F-W14-round-1-resumed.zip zweryfikowana: SHA-256
`4e84ff8c2c8d2706a166b7d1cd30efda2ddf2cd58be4cf1b1f87bc624b735e8e`.
Codex niezależnie: 19 testów harnessu PASS, osiem prób hosta MCP bez modeli PASS
w sensie potwierdzenia obserwacji: pluginowy MCP nie otrzymuje wiarygodnego worktree.
Claude potwierdził instrukcje przez --plugin-dir i usuwanie starego cache Codexa przy update.
[Review 01](../features/F-W14-plugin-distribution/reviews/01-contracts.md): REWORK
propozycji, zachowane dowody prób. Poprawki: instrukcje poza projektem, działający
bootstrap nowego worktree, dowód konkurencji, prywatność metadanych diagnose.
Następny krok W14-02 w istniejącej zgodzie. Brak implementacji produktu i pełnych testów JS.

## 2026-09-16 — implementacja rundy2, review REWORK

Task `task_a5b6kt56sk` DONE w tej samej sesji. Commity `8c1cd85`, `7d2e096`, `3c61427`.
Paczka F-W14-round-2.zip integralna, SHA-256 `889cc5f6af43da315f207f0a4272a2bbae3b0cb04c071738395ef631c30d22b0`.
Claude: build,461 JS,41 Python,140 pilot (1 skipped); Codex:27 focused JS PASS.
[Review02](../features/F-W14-plugin-distribution/reviews/02-implementation.md):
REWORK — brak kompletnej instalacji runtime z pluginu, niedziałający eksporter w obcym
repo, pin/foreign/custom-config nie blokują launch/zapisu, SIGTERM dispatchera zostawia
proces runtime, macierz przecenia dowody z fixture. Reprodukcje tylko syntetyczne /tmp.
Następny krok: spójna korekta R2-01–05 bez nowych pytań produktowych.
Użytkownik delegował roboczy interfejs wave13; [decyzja02](../features/F-W14-plugin-distribution/decisions/02.md)
zapisuje kod cf2365c i review853302c. Wspólna integracja po odbiorze wave13, nie blokuje
niezależnej pracy. Bez push,merge,wdrożenia,zmian wave13 i dodatkowych pilotów modeli.

## 2026-09-16 — runda3 i ścisłe wznowienie, review nadal REWORK

Task `task_v62rz4kag7`: BLOCKED przez format dowodów reprodukcji, następnie DONE po
wznowieniu tego samego zadania/sesji. Head `f490b46`, pin runtime `6b483b2`.
Paczka F-W14-round-3-resumed.zip zweryfikowana niezależnie, SHA-256
`b2b03c21540c1b4746c38376ccd082b395c6616e21a4de9c0ec8837b00a584aa`.
Claude: build,468 JS,43 Python,140 pilot (1 skipped), packages check PASS.
Usunięto równoległy setup/fasadę, instalator używa wave12, instrukcje pozostają w runtime,
eksporter działa w obcym repo, launch jest w jednym procesie. Nowe worktree startuje
bez zapisu; pierwsza autoryzowana mutacja przygotowuje wybór runtime.
Codex niezależnie: eksport/verify i lokalna instalacja domyślnego pina PASS; realny
runtime ujawnił blokowanie obu równoczesnych pierwszych użyć tego samego worktree
oraz brak restartu po przerwaniu automatycznej inicjalizacji. Plan setupu zapisuje runtime
mimo opisu dry-run. [Review02](../features/F-W14-plugin-distribution/reviews/02-implementation.md)
zawiera R2-06–08, dokładne commity i reprodukcje. Kolejny krok: wąska korekta na istniejącej
granicy guarda/wyboru runtime, ponowne testy i końcowy review. Bez nowej decyzji produktowej.
Wave13 nadal bez integracji do czasu odbioru; żadnego push,merge,wdrożenia ani pilota modeli.

## 2026-09-16 — runda4, współbieżność i dry-run poprawione

Task `task_cv5d1hf7qs` DONE, head `219bfe6`, runtime `2423307`.
Paczka F-W14-round-4.zip SHA-256 `4b7cf11fefa256dab2c9b5c5474b6aebbf7053f0ee8120c894645cfb75be6dd1`
zweryfikowana. Claude:475 JS,43 Python,140 pilot (1 skipped), build/packages PASS.
Codex powtórzył reprodukcje: jeden właściciel i odmowa obcego managera w tym samym
worktree PASS; plan setupu bez żadnego zapisu PASS; odzyskanie po pierwszym zapisie PASS.
Pozostają przerwanie przed journalem i domknięcie journalu po zapisie rekordu oraz
rollback bez --to wybierający obecną wersję. Review02 zawiera dokładne dowody R2-07/09.
Dodatkowa próba TUI bez modeli: zwykły Codex pokazuje 35 narzędzi MCP i skill bridge,
bez tworzenia stanu. Claude odnotował omyłkowy test w realnym katalogu runtime i usunięcie
wyłącznie własnego nowego runtime; nadzorca niezmieniony. Dalsze próby tylko w jawnym /tmp.
Następny krok: wąska korekta istniejącego recovery i wyboru rollbacku, finalne testy/review.
