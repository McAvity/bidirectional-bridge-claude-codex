# Review W13-01 — logowanie i retencja

REWORK. Kod i testy dostarczono, ale izolacja zapisów i retencja naruszają plan.
Brakuje części wymaganych zdarzeń diagnostycznych. Blocker eksportu jest błędem
przygotowania koordynatora: indeks używał docs/tasks zamiast work-items; poprawiono
robocze dokumenty. Zwykłe poprawki mieszczą się w decyzji 01, bez decyzji użytkownika.

## Zakres i dowody

2026-09-16; Codex jest koordynatorem i reviewerem niezależnym od implementującego Claude’a.
Task bridge task_az31bjhxqv, baza 09da710c12167037deaed395f0dfcd1863d8c7a5,
wersja oceniona 10c38b4 (kod c894d5c; później wyłącznie ledger).
Plan docs/plans/wave13.md, SHA-256 b51cdc3ea55461e1f94dab33ab37aba9ee3f9e739fbd41049bc59aeb00bce840.
Paczki brak: eksport odrzucił ścieżki tasków; review kodu bezpośrednio z repo,
nie deklaruje zweryfikowanej paczki. Zmiany wykonawcy mieszczą się w kontrakcie.
Niezależnie: npx vitest run shared/control-plane/src/diagnostics-log.test.ts
shared/mcp-server-core/src/native-launcher.test.ts — 26/26 PASS. Zastany Python:
29 exchange + 140 pilot PASS. Wykonawca raportuje build i 452 JS PASS.

## R1-01 — odmowy i odczyty zapisują log po wcześniejszym uzbrojeniu

Blocker AC-02 i sekcji „Izolacja przed zapisem”. runTool.finished zawsze wywołuje
logger.record; samo arm ogranicza jedynie utworzenie pliku. Test „logs an authorized
session automatically” wręcz wymaga wpisu MANAGER_FOREIGN_THREAD po wywołaniu innej
natywnej sesji na tej samej instancji. Odczyty również trafiają do pliku. To narusza
odmowę/odczyt bez mutacji niezależnie od wcześniejszej autoryzacji procesu.
Globalne authorizedCall/armedThisCall dodatkowo nie są kontekstem pojedynczego requestu;
jedna para manager/feature nie oznacza jednego wywołania MCP naraz.
Naprawa: per-call uprawnienie zapisu, brak zapisów plików dla odczytu/odmowy,
ograniczony stderr zamiast tego. Sprawdzić fingerprint po uzbrojeniu dla foreign,
invalid metadata i read, także przy trwającej operacji async; sprawdzić utratę
uprawnienia instancji przy takeover i późniejszym zamknięciu. Nie zmieniać kontraktu
izolacji ani udawać, że ograniczenie do świeżego procesu spełnia wymaganie.

## R1-02 — od setnej rotacji retencja przestaje rozpoznawać własne pliki

Blocker AC-03. FILE_PATTERN wymaga dokładnie dwóch cyfr, openNextFile generuje 100,
101 itd. Niezależna reprodukcja na publicznej poprawnej konfiguracji:
maxFileBytes=65536, maxTotalBytes=262144, maxFiles=2; 115 rotacji przez record()
zostawia 18 plików JSONL. config.problems jest puste. Poprawić wzorzec/nazewnictwo
i dodać regresję przekraczającą 100 rotacji z aktywnym plikiem chronionym.

## R1-03 — brak wymaganych punktów obserwacji i nieprawdziwy opis stderr

Blocker sekcji 1 / AC-01 dla zakresu logowania. Zmiany nie podłączają obserwacji
rozpoczęcia/zakończenia próby ani błędu zapisu evidence: emitowany jest dopiero
call.finished, a manager.authorized nie zawiera task/attempt. Przy żywej, długiej
rundzie brakuje korelowalnego wpisu startu próby. Walidacja schematu MCP odbywa się
przed runTool. record() bez fd tylko zwiększa deferred i wraca; nie emituje stderr,
choć dokumentacja i ledger deklarują obecność tych rekordów w stderr.
Naprawa: małe metadane przy rzeczywistych punktach próby/adaptera/evidence oraz
bezpieczne ograniczone raportowanie odmów/walidacji bez mutacji. Zachować istniejący
magazyn stderr, bez duplikowania payloadów bazy. Testy: start widoczny w czasie
trwania syntetycznej próby, zakończenie/timeout, błąd adaptera/evidence, walidacja;
nie logować promptów/args. Udokumentować faktyczne braki zamiast deklarować zapis,
którego nie było. Doctor status można domknąć w W13-02/03, zgodnie z planem całości.

## Ustalenia nieblokujące

Symlink znacznika .active nie zmienił pliku docelowego w niezależnej reprodukcji;
nie zgłaszam tego jako potwierdzonego błędu. EOF gap ma test na rzeczywistym launcherze
zamiast zakładanej przyczyny; nie wymaga tu naprawy ogólnego cyklu życia runtime.

## Następny krok

Wznowić ten sam BLOCKED task po poprawie dokumentów koordynatora. Nie commitować
zmian koordynatora, dopóki runda pozostaje otwarta. Claude poprawia R1-01–03 w swoim
istniejącym zakresie, zachowuje wcześniejsze ledgery i dodaje kolejny; eksportuje
oryginalny zakres rundy. Po DONE zweryfikować paczkę i wykonać wąskie re-review.

## 2026-09-16 — re-review korekty, PASS zakresu W13-01

Task task_az31bjhxqv, kod 59b3de386d2f570abb7b40480cae71d2565d7688,
HEAD 50073f5dd0f79f761c0eceb67fb1ca6921d9067c (następne commity wyłącznie ledgery).
Paczka F-W13-round-1-report-fixed.zip: SHA-256
4e180e8ffbe04640e0960fc7ffe2f43fe80e97108ab61acec82bf4f89d425ce5;
verify z expect-feature/purpose/base/head PASS, 17 zmian kodu, dokumenty bez driftu.
Dokumenty koordynatora w paczce to jawny roboczy snapshot; kod ma osobny zakres commitów.

R1-01 resolved: per-call CallAudit, odczyty/odmowy kierowane wyłącznie do stderr;
fingerprint sprawdzony po uzbrojeniu i podczas aktywnej próby. Takeover zamyka
deskryptor bez zapisu i bez usuwania znacznika. R1-02 resolved: wzorzec obsługuje
rosnący indeks; niezależna identyczna reprodukcja 115 rotacji zostawia 2 pliki
przy limicie 2. R1-03 resolved w zakresie implementacji: obserwacja start/finish,
evidence i błędów bookkeeping w orkiestratorze, faktyczny bounded stderr.
Produktowa walidacja jest logowana; odrzucenie samego schematu przez SDK przed
wejściem do bridge jest jawnym ograniczeniem obserwacji, bez twierdzenia, że je zapisano.

Niezależne 30 testów loggera/launchera PASS na finalnym kodzie; wykonawca build i
456 JS PASS. Test wskazany dodatkowym nieistniejącym filtrem diagnostics-attempts
nie dostarcza dowodu — rzeczywiście uruchomiono tylko dwa istniejące pliki, 30 testów.
W13-03 ma domknąć pełną macierz planu, w tym wymuszone błędy adaptera/evidence
i klienta oraz status doctor; tego PASS nie należy traktować jako odbioru całej wave13.
Pierwotny worker red-run miał nieopisany snapshot; zachowano go jako narrację,
nie strukturalny dowód. Niezależna reprodukcja koordynatora była na c894d5c przed
naprawą i 59b3de3 po niej. Raport-only resume dodał ledger03 i poprawną paczkę.
Następny krok: W13-02 i W13-03 w jednej sekwencyjnej rundzie implementacji i walidacji,
następnie niezależne review całego wyniku. Nie jest to akceptacja featura.
