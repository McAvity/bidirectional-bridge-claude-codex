# Review implementacji — REWORK, 2026-09-16

Koordynator Codex, niezależny od wykonawcy Claude (uczestniczył w koordynacji).
Task task_axt2g9bfzf; e66c6d7..ea7d1bd75e2c418c96694bb5c07cbac31cb571d5.
Paczka r02 PASS, zakres czysty. Poniższe wymagane korekty mieszczą się w decisions/01.
W15-03 może być implementowane razem z nimi zgodnie z rozstrzygniętym kierunkiem;
W15-02 nie jest jeszcze zamknięte. Bez nowej decyzji użytkownika i bez zmiany MCP API.

## W15-I1 — preferencja legacy wskazuje nieistniejące wejście (blocker AC-03/08)

scripts/bridge.mjs wywołuje planChange domyślnie profile=legacy. PREFERENCE_BLOCK zawsze
wskazuje .bridge-project/entry.mjs, ale legacy go nie instaluje. Niezależna próba
planChange(init, preference=true) w pustym tymczasowym repo: ok=true,
entryCreated=false, preferenceMentionsEntry=true. Minimalna poprawka: jawna nazwana
odmowa opcji dla legacy z kierowaniem do istniejącego setupu dispatcher; nie rozszerzać
instalatora ani nie przepinać projektu automatycznie. Alternatywnie poprawne wejście
legacy, tylko jeśli prostsze i rzeczywiście zweryfikowane. Test uruchamia wskazane wejście
albo potwierdza odmowę przed zapisami, nie tylko sprawdza tekst.

## W15-I2 — nowy AGENTS.md bez konkretnego diffu (blocker wymogu planu)

planPreference create nie ustawia previous, oba CLIs dodają diff tylko gdy previous
istnieje. Niezależna próba: hasPrevious=false. Plan dla projektu bez AGENTS.md pokazuje
jedynie nazwę pliku, a nie treść proponowanej preferencji. Pokazać diff od pustej treści
na obu publicznych powierzchniach; regresja dla brakującego i pustego pliku.

## W15-I3 — plugin status nie sprawdza commita pinu (blocker AC-03/08)

locate.status weryfikuje runtime, ale nie porównuje manifest.source.commit z deklaracją.
Niezależna próba na realnym zainstalowanym runtime i syntetycznej deklaracji z commit=40 zer:
state=inherited-pristine, runtime=ok, instructionsAvailable=true. Nowy entry ten mismatch
odmawia; plugin ładuje wtedy niewłaściwy zestaw. Wspólna klasyfikacja: mismatch ->
brak instructions, konkretny kod/next step, bez zapisu. Test obu wejść na tym samym stanie.

## W15-I4 — marker nie dowodzi preferencji (blocker AC-02)

hasPreference zwraca declared=true dla dowolnego poprawnego bloku. Próba z treścią
„Never delegate implementation.” wewnątrz markerów również dała declared=true.
Nie przedstawiać obecności markerów jako zgody. Status może rozpoznać dokładny znany
blok; zmieniony/nieznany tekst wymaga przeczytania AGENTS i interpretacji instrukcji,
a „zrób sam”/zakaz zawsze wygrywa. Zwykła ręczna preferencja poza markerami także może
być ważna: flagi techniczne nie są źródłem autoryzacji. Dodać regresję zaprzeczenia.

## W15-I5 — cienkie wejście pluginu (blocker wskazanej granicy planu)

Szablon kopiuje klasyfikację brief/plan/review z role skill, zamiast tylko wykrywać
zlecenie i ładować instrukcje wybranego runtime. To tworzy wersję workflowu niezależną
od pinu. Zostawić trigger i minimalne granice zgody/setupu; klasyfikację i prowadzenie
pracy utrzymać kanonicznie w przypiętym role/workflow. Dokumentacja ma wskazać, że
nowy --status wymaga runtime z wave15; nie uruchamiać flagi na starszym dispatcherze
jako pewnego odczytu (starszy kod traktuje ją jak zwykły start MCP).

Dowody: odczyt pełnego diffu kodu/instrukcji/testów; izolowane próby Node planChange
oraz locate.status na rzeczywistym runtime, bez modelu i bez zmian jego plików.
Paczka, diff check PASS. Testy wykonawcy: 6 entry/plugin + 3 preference PASS;
nie pokrywają powyższych przypadków. Pełna walidacja po korektach.

## Review korekt i W15-03 — 2026-09-16, task_ztxwvbm7ez

REWORK wyłącznie w dowodach C2 i I6; 02ced395dc13e9f09722b8ad8707e3d040dab299.
Paczka r03 integrity/range PASS, 30 plików w scope, czysty worktree.
I1: resolved — niezależna próba zwraca PREFERENCE_REQUIRES_DISPATCHER i ok=false.
I2: resolved — previous=Buffer.alloc(0) daje diff dla nowego pliku; testuje brak/pusty.
I3: resolved — niezależna próba zwraca pin-commit-mismatch i instructions=null;
plugin i entry współdzielą klasyfikację, test porównuje oba wejścia.
I4: resolved — blok zakazujący delegacji daje modified, authoritative=false;
instrukcje nakazują odczytać rzeczywiste AGENTS, nie traktować flagi jako zgody.
I5: resolved — plugin odsyła klasyfikację do przypiętego role skill; nowy entry
sprawdza describe zamiast wywołać launch starszego runtime; granica wersji opisana.

## W15-I6 — dowód no-handle nie sprawdza deklarowanej granicy (blocker wiarygodności)

wave15-continuation.test.ts przypadek „dead server” utrzymuje aktywny gated adapter;
nie zabija procesu, nie usuwa żywego lease, akceptuje błąd /lease|persisted execution handle/.
Także po usunięciu guardu brakującego handle test nadal przejdzie dzięki lease. Ledger
W15-03/01 nazywa to martwym serwerem i deklaruje stop na brakującym handle — ponad dowód.
Korekta: syntetycznie utworzyć stan osieroconej próby bez handle i BEZ żywego lease,
bez uruchomionego adaptera, po odtworzeniu bazy żądać dokładnego błędu no-handle
oraz niezmienionych tasków/prób/historii. Można użyć kontrolowanego crash hook lub
jawnie syntetycznego stanu trwałego; nie potrzeba realnego procesu modelu.
Nie twierdzić, że drugi connection/reopen jest realnym restartem procesu. Nazwać
wprost granicę dowodu i zachować starszy ledger, dodając korektę w nowym.
Scenariusz „waiting_user, foreign, closed” nie testuje closed; skorygować nazwę/opis
lub dodać właściwą asercję (bez sugerowania empirycznego foreign Codex thread,
który jest pokryty osobnymi istniejącymi testami identity).

Następna runda: wąskie testy C2/I6, brak semantycznych zmian runtime, W15-04 raport
z pokryciem AC i proponowanym pinem. Pełne npm test uruchomione niezależnie przez
koordynatora; wynik jeszcze oczekiwany. Python46 i pilot140 PASS na niezmienionych
obszarach. Smoke pozostaje niezlecony, zachowanie modeli unverified.

## W15-I7 — pełna walidacja: stary kontrakt identycznych skilli

Pełne npm test uruchomione przez koordynatora na kodzie 38dd547 (kolejne zmiany do
02ced39 dotyczą dokumentacji/pomocy, bez zmiany badanych zachowań): 560 PASS, 1 FAIL,
37 plików, 283.16s. native-launcher.test.ts:405 wymaga byte-identical SKILL.md obu ról.
Wave15 wprost rozdziela role; nie kopiować manager workflow do wykonawcy tylko po to,
aby test przeszedł. Dostosować regresję do nowego kontraktu: wspólne zasoby pozostają
spójne, entry skille są poprawne dla swoich ról, Claude executor nie przejmuje managera.
Zachować meaningful assertions, nie usuwać kontroli całego pakietu.
To konieczna korekta walidacji w istniejącym zakresie, nie nowa decyzja produktowa.

## Review rundy 4 — task_16hy41wpzb, 55cb52a, 2026-09-16

Paczka r04 PASS: SHA256 6326351fef9ed0fc6885312d741b9a8829729657723d128b28242a9bfb1ab813,
6 plików w scope, czysty worktree. I6/I7 resolved. Koordynator niezależnie uruchomił
12 regresji continuation/role PASS oraz dodatkową próbę otwartego WORKING orphan:
syntetyczna trwała próba bez handle i bez live lease, reopen SQLite, exact no-handle
INVALID_ARGUMENT, zero invoke i identyczne task/attempt/event/lease przed/po.
Nie zabijano procesu. Dodatkowe próby: actual ff225e5 + NOWY entry -> RUNTIME_WITHOUT_STATUS,
zero state; preference symlink/duplicate -> refuse before apply, bytes unchanged.
Wykonawca: build, pełne JS563/37 plików, packages/links/diff PASS na 0b563ba.
Koordynator: build/packages/links/diff PASS, dokumentacja162. Python46/pilot140 retained.

## W15-I8 — nowy plugin + stary pin zapisuje bezużyteczne wejście (blocker AC-03/08)

To odrębny reprodukowalny przypadek od próby NOWEGO entry na starym runtime:
1. Puste tymczasowe repo z kanoniczną deklaracją wskazującą istniejący ff225e5.
2. Bieżący bridge-plugin.mjs setup --with-preference --yes --json.
3. Wynik: ok=true, applied=true, AGENTS wskazuje entry.mjs --status.
4. Setup skopiował jednak STARY entry-template przypiętego runtime. Jego --status
   uruchamia zwykłą ścieżkę MCP, kończy przy EOF z exit0/stdout0, nie zwraca status JSON.

Samo ograniczenie do profilu dispatcher nie wystarcza. Przypięty starszy runtime
pozostaje częstym przypadkiem (także obecny release pin). Wąska poprawka: odmówić
--with-preference przed zapisem, gdy wybrany runtime nie obsługuje czystego wejścia;
konkretny kod i następny krok, bez automatycznej zmiany pinu, nowego instalatora lub
MCP API. Sprawdzić zdolność RZECZYWISTEGO target runtime, nie wersji pluginu. Dodać
regresję przez rzeczywistą publiczną ścieżkę setupu ze starszym targetem: zero zapisów.

Step-back (trzecie sprawdzenie klasy problemu „preferencja wskazuje niedziałające
wejście”, I1/I5/I8): cel to jedno poprawne wejście dla wybranego runtime. Najprościej
odmówić zapisu niewspieranej preferencji; nie dopisywać fallbacków wybierających inne
skille/runtime. Zachować wspólne źródło klasyfikacji i istniejący setup.

Raport końcowy: wyrażenie „no model ran in any round” jest nieprecyzyjne — brak modeli
dotyczy TESTÓW/smoke, a implementację rzeczywiście wykonały rundy Claude przez bridge.
Skorygować aktualny final-report, zachować historyczne ledgery i dodać sprostowanie
w nowym W15-04 ledgerze. Uwzględnić powyższe dodatkowe dowody koordynatora, bez claimu
własnego rerun. Pozostałe findingi zamknięte; tylko I8 wymaga korekty kodu.

## Final review — PASS, 2026-09-16

Runda 5 task_8prrdyndtz DONE, revision 292cb1455ad40b8b31fedf3861c0525cf26d8b0d.
Paczka r05: SHA256 a41aed28bd779c6a655a51f7522c5c307fcbb5e6548376c7700490f4dfd025e3;
koordynator zweryfikował integralność, provenance, zakres 11 plików i czysty worktree.
I8 resolved: capability czytane z target runtime, odmowa przed zapisami, bez uruchamiania
obcego kodu lub zmiany pinu. Niezależna próba koordynatora z rzeczywistym ff225e5:
PREFERENCE_UNSUPPORTED_RUNTIME, exit1/applied=false, identyczna deklaracja i lista plików,
AGENTS nie powstał. Regresja wykonawcy obejmuje publiczny setup historycznego runtime
i działający wspierany target. Review kodu potwierdza precondition przed planPreference.

Wykonawca: pełne JS565/37 plików PASS, build/packages/links/diff PASS; focused I8 2 PASS.
Koordynator: retained focused continuation/role12, Python46/pilot140, niezależne próby
opisane wyżej; końcowe build/packages/links/diff PASS. Nie przypisujemy koordynatorowi
własnego pełnego JS565 rerun. Raport poprawnie rozróżnia Claude implementation od
testów bez modeli. C1-C4 i I1-I8 resolved. Step-back doprowadził do prostego intent JSON
z istniejącym replay oraz do odmowy niewspieranego targetu, bez nowego protokołu.

PASS dla całego zleconego zakresu implementacji. Behawioralne AC-01/02/07 wymagające
model smoke pozostają nieweryfikowane zgodnie z wyłączeniem użytkownika; to nie claim
pełnego real-agent acceptance. Ograniczenia capability source-check, no-handle strict
stop i brak automatycznej naprawy historycznych bloków są jawne w raporcie/handoff.
Odbiór użytkownika nadal pending; review nie jest zgodą na publikację ani wdrożenie.
