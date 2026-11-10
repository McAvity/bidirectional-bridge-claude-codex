# Review 02 — wykonanie F-W21

## Etap W21-01 — 2026-11-10

**PASS dla dostawy dokumentacyjnej W21-01.** Instrukcje i szablony realizują
zatwierdzony minimalny zakres, bez nowego runtime'u ani odtwarzania pełnego Bridge'a.
Nie stwierdzono wymaganych poprawek ani nowych uwag nieblokujących.
**Pełny wynik produktu i dowody pilota: PENDING.** Ten werdykt nie oznacza
spełnienia AC-01/03/05 ani końcowego odbioru featura. Następny krok to ocena
dowodów W21-02 i zintegrowanego wyniku w tym samym rejestrze; Gate 2 pozostaje otwarta.

## Wejścia i niezależność

- Dostawa: c0cd9cf847819e128e3f24710924c37ae89c96dc; baza
  3cf24884e095f31279985b0c98307aae43aa8114.
- Sprawdzony zakres: pięć plików docs/hcom-mvp/ oraz odpowiadający im diff;
  ledger execution/W21-01/01.md odczytano jako deklaracje wykonawcy.
- Brief SHA-256: 73a087e4635e382a8be6f43c9c83dd52fc02244306db65fe408b10f46788f875;
  plan z korektą433884f, decyzja03 ze zgodą wykonawczą i W21-01.
- INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74
- Źródło hcom: de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf (0.7.31), tylko odczyt.
- Reviewer jest osobnym agentem, niezależnym od wykonawcy dokumentacji i pilota;
  wcześniej recenzował plan. Nie uruchamiał hcom/modeli, nie wykonywał mutacji MCP
  ani nie czytał aktywnych plików i transkryptów pilota.

## Ustalenia i pokrycie

1. README prowadzi od izolowanego HCOM_DIR i repo, przez launch bez zadaniowego
   promptu, kontrolę session_id/directory, pojedynczy send i odbiór, do korekty
   w tej samej sesji oraz zakończenia własnego klienta. Trust i brak tożsamości
   wymagają jawnej diagnozy; nie ma zastępczego procesu ani ślepych zgód.
2. Kontrakt zawiera task/rundę, cel, workspace, write_scope, check i report_path.
   Raport podaje rzeczywiste zmiany przez base/diff lub commit i odróżnia
   passed/failed/not_run. Przykład jest jawnie syntetyczny, partial/not_run.
   Worker wymaga uwzględnienia nowych plików w dowodzie. To spełnia część
   dokumentacyjną AC-02; zastosowanie w pilocie pozostaje do oceny.
3. Checklista rozróżnia brak raportu, obce/stare ID, niezaliczony lub niewykonany
   test, timeout i zmienioną sesję. Idle/RESULT_READY/complete nie zastępują
   odbioru. Desk-check siedmiu opisanych przypadków daje zgodne decyzje;
   nie jest dowodem automatycznego walidatora ani zachowania modeli (AC-04).
4. R01-N01/N02 pozostają resolved: jeden pierwszy send po kontroli sesji,
   każdy task prompt liczony w budżecie; query przed wait i po timeout, od
   zapisanego czasu, jawny limit wyników oraz instrukcja odczytu większej historii.
   Worker nadaje inform przez hcom; koordynator sprawdza task/rundę samodzielnie.
5. Zakres jest opt-in, dokumentacyjny i lokalny. Limit jednego taska/wykonawcy,
   brak exactly-once/recovery/sandboxu i budżet są jawne. Diff nie zmienia
   zwykłego runtime'u Bridge ani projektów użytkownika (AC-06).

## Kontrole i ograniczenia

- Oba przykłady parsują się jako JSON: niezależnie PASS.
- Wszystkie pięć bloków sh w README/worker: `sh -n` PASS; nie wykonano ich.
- Diff dostawy `3cf2488..c0cd9cf`: `git diff --check` PASS.
- Odczyt przypiętego kodu potwierdza składnię i semantykę użytych prymitywów:
  commands/launch.rs (extract_launch_flags, przekazanie argumentów klienta,
  preview/--go), integration_spec.rs (flagi Claude), commands/send.rs
  (send -b, inform i broadcast), commands/list.rs (JSON z session_id/directory),
  core/filters.rs (from/type/intent/after), commands/events.rs (query filtruje
  przed LIMIT, wait ma lookback, follow/after-id), commands/term.rs (clean).
  Data z `date -u` pasuje do akceptowanego formatu filtra after.
- Deklaracje ledgera o lokalnych wersjach, odczycie --help i kontroli linków
  zachowano jako dowód wykonawcy; reviewer nie powtarzał wywołań hcom.
- Nie uznaje się składni, kodu źródłowego ani desk-check za dowód realnej
  komunikacji, korekty w tej samej sesji czy wyników testów zadania modelowego.
  AC-01/03/05 i pełne zastosowanie AC-02/04 oczekują materiału W21-02.

Nie ma blockerów W21-01; brakujący pilot nie jest defektem tej częściowej dostawy.
