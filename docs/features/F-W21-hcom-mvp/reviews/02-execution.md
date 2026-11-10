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

## Końcowe review W21-01/W21-02 — 2026-11-10

**PASS dla całego uzgodnionego MVP F-W21.** Dostawa
5ee958bc34353bda2feda6a3d4f92f7e24fa4de7 zawiera rzeczywistą pierwszą rundę,
review, poprawkę w tej samej zapisanej sesji i jawny odbiór. Nie stwierdzono
blockerów ani nowych uwag wymagających korekty. Powyższe PENDING opisuje historyczny
etap W21-01; poniższe dowody rozliczają brakującą część W21-02.
Rekomendacja: przekazać wynik do **Gate 2**. PASS jest oceną review,
nie akceptacją użytkownika, zgodą na migrację projektów ani dowodem przewagi nad Bridge'em.

### Zakres i dowody

Sprawdzono zintegrowane docs/hcom-mvp/, evidence/, ledger W21-02 i zmiany
c0cd9cf847819e128e3f24710924c37ae89c96dc..5ee958bc34353bda2feda6a3d4f92f7e24fa4de7.
Etapowe review pozostaje zachowane w 0ceac0d. Brief, plan i zgoda03 są niezmienione;
R01-N01/N02 nadal resolved. Realna poprawka testu/docstringu mieści się w planie
i została uczciwie odróżniona od funkcjonalnego błędu.

Oprócz publikowanych artefaktów reviewer odczytał wskazane lokalne dowody
zakończonego pilota: operator/state.json, history-final.jsonl, session-final.json,
kopie obu rund, końcowe kontrakty/raporty/diffy oraz session-stopped.txt.
Nie przeniesiono prywatnych ścieżek, nazw ani natywnych ID do tego rejestru.
Nie odczytywano transkryptów modelu ani nie uruchamiano hcom/modeli/MCP.

- Historia zawiera dwa requesty6/26 do jednego wykonawcy i dwa inform23/46
  z RESULT_READY odpowiednich rund. Treść drugiego requestu przekazuje konkretną
  uwagę test/doc oraz odsyła do contract-r2; nie uruchamia zastępczej sesji.
  Powiadomienia mają zero odbiorców inbox, lecz istnieją w historii; raport
  prawidłowo opisuje ten kanał odbioru zamiast obiecywać automatyczny inbox Codexa.
- Zapisany native session_id i katalog w state są zgodne z session-final.
  Kontrole przed pierwszym zleceniem i korektą pozostają udokumentowanymi
  czynnościami koordynatora; końcową zgodność reviewer sprawdził niezależnie.
- Publikowane kod/testy/raporty/diffy obu rund są bajtowo zgodne z lokalnymi
  kopiami operatora. Oba raporty i diffy nadal istnieją niezmienione po rundzie2;
  SHA-256 diffów odpowiadają zapisowi odbioru. Kontrakty odpowiadają lokalnym
  oryginałom po jedynej zamianie workspace na placeholder.
- ID/czasy/recipient_count w observations.json zgadzają się z historią.
  Licznik jednej próby i dwóch zleceń zgadza się ze stanem operatora i wiadomościami.
  Czas send→ready obu rund mieści się w 10 minutach, cały odcinek send→odbiór
  w 45 minutach. Liczbę trust i 11 zgód zachowano z zapisu operatora;
  reviewer nie rekonstruował jej z transkryptu. Koszt i czas aktywnej obsługi
  prawidłowo pozostają nieznane, nie są zastępowane zerem ani wymyśloną precyzją.
- session-final był snapshotem sprzed zakończenia (listening).
  Osobny zapis session-stopped.txt potwierdza stopped i exit:prompt_input_exit;
  nie uznano samej deklaracji odbioru za dowód zatrzymania wykonawcy.

### Niezależna walidacja

- Opublikowane snapshoty: unittest runda1 **6 PASS**, runda2 **7 PASS**,
  z PYTHONDONTWRITEBYTECODE=1. To ponowne testy dostarczonego kodu, nie ponowny pilot.
- Hash docelowego bloba każdego pliku w delivery.patch obu rund zgadza się
  z publikowanym kodem/testem. Runda2 zachowuje logikę i sześć wcześniejszych
  testów; nowy test sprawdza brak mutacji wejścia i odrębny obiekt wyniku.
- JSON-y dowodów i przykładów parsują się. Checker dokumentacji: 289 Markdown,
  zero broken_links i absolute_paths; jedyny loose substring dotyczy historycznego F-W19.
- `git diff --check c0cd9cf..5ee958b`: PASS. Zakres nie zawiera zmian runtime'u
  ani konfiguracji istniejących projektów. Pełne CI runtime'u nie było potrzebne
  dla tej dostawy dokumentów i syntetycznych artefaktów.

### Kryteria i granice wniosku

| Kryterium | Ocena i dowód |
| --- | --- |
| AC-01 | met: request6 → ready23, zgodny raport/diff i 6 testów; hcom przenosi wiadomości, bez kopiowania odpowiedzi przez użytkownika |
| AC-02 | met: oba kontrakty i raporty zawierają wymagane pola; zmiany identyfikowalne, testy rzeczywiście powtórzone |
| AC-03 | met: request26 zawiera uwagę review, zapisane powiązanie sesji zachowane, poprawka i raport2 odebrane po 7 testach |
| AC-04 | met w uzgodnionym ręcznym MVP: jawna checklista przypadków obcych/starych/brakujących raportów i niezaliczonych testów; timeout prowadzi do historii/diagnozy, bez automatycznego zastępcy; przypadki negatywne są uczciwie oznaczone desk-check |
| AC-05 | met: pilot-summary i observations podają wersje, zakres, interwencje, czasy, ograniczenia i proporcjonalną rekomendację |
| AC-06 | met: procedura opt-in, wyłącznie dokumenty i dowody; brak nowych mechanizmów runtime'u i zmian zwykłego Bridge'a |

Wykonanie eksperymentu jest poprawne dla jego ograniczonego celu. Hipoteza dostała
pozytywny wynik w jednej lokalnej próbie: minimalny kontrakt i jawny odbiór
wystarczyły do zamknięcia dwóch rund. To nie jest pomiar niezawodności, kosztowej
przewagi, bezobsługowości ani gotowości wieloprojektowej. Rekomendacja małych
prób opt-in i dalszego pomiaru obsługi zgód odpowiada dowodom; pełny adapter
i powszechna migracja nie wynikają z tego wyniku. Wymagany wynik produktowy
MVP jest wykazany; końcowa akceptacja użytkownika pozostaje otwarta.
